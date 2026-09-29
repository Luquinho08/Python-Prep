import "server-only";
import { and, desc, eq, inArray, lt, or, sql } from "drizzle-orm";
import { db, type Tx } from "../db";
import {
  carts,
  cartLines,
  couponRedemptions,
  incidents,
  orderEvents,
  orderLines,
  orders,
  paymentAttempts,
  payments,
  products,
  productVariants,
} from "../db/schema";
import { env } from "../env";
import { enqueueEmail } from "../email/outbox";
import { incidentAdminEmail, orderPaidAdminEmail, orderPaidCustomerEmail } from "../email/templates";
import { getStoreSettings } from "../content/settings";
import { recordEvent } from "../analytics";
import { orderLink, orderNumber } from "../orders/access";
import { consumeForApprovedOrder, extendReservations } from "../orders/reservations";
import { getGateway, markConnectionRevoked, requireGateway } from "./connection";
import { aggregatePayments, FINAL_OK, IN_FLIGHT, rejectionMessage } from "./status";
import {
  GatewayAuthError,
  GatewayConfigError,
  GatewayRejectedError,
  GatewayTimeoutError,
  type InternalPaymentStatus,
  type PaymentGateway,
  type ProviderState,
} from "./types";

type Order = typeof orders.$inferSelect;
type Attempt = typeof paymentAttempts.$inferSelect;

export class PaymentFlowError extends Error {
  constructor(
    message: string,
    public code: "not_payable" | "in_flight" | "amount_changed" | "reservation_expired" | "config" | "already_paid",
    public httpStatus = 409,
  ) {
    super(message);
  }
}

const PAID: InternalPaymentStatus[] = ["approved", "partially_refunded", "refunded", "charged_back"];

async function adminEmail() {
  const s = await getStoreSettings();
  return process.env.ADMIN_NOTIFICATION_EMAIL || s.contactEmail;
}

async function openIncident(tx: Tx, order: Order, kind: (typeof incidents.$inferInsert)["kind"], details: Record<string, unknown>) {
  const [inc] = await tx.insert(incidents).values({ orderId: order.id, kind, details }).returning();
  await tx.insert(orderEvents).values({ orderId: order.id, type: "incident", toValue: kind, message: JSON.stringify(details).slice(0, 500) });
  const mail = incidentAdminEmail(kind, orderNumber(order.number), JSON.stringify(details), `${env.appUrl}/admin/pedidos/${order.id}`);
  await enqueueEmail({ dedupeKey: `incident:${inc.id}`, to: await adminEmail(), ...mail }, tx);
  return inc;
}

/** El pedido se puede cobrar: no pagado, no reemplazado, con reservas vigentes. */
export async function assertPayable(order: Order) {
  if (order.supersededBy) throw new PaymentFlowError("Este pedido fue reemplazado por uno más reciente. Volvé al checkout.", "not_payable");
  if (PAID.includes(order.paymentStatus as InternalPaymentStatus)) throw new PaymentFlowError("Este pedido ya está pagado.", "already_paid");
  if (order.cancelledAt) throw new PaymentFlowError("Este pedido fue cancelado.", "not_payable");
  if (order.reservationExpiresAt && order.reservationExpiresAt < new Date()) {
    throw new PaymentFlowError("La reserva de tu pedido venció. Volvé al checkout para revisar precios y disponibilidad actualizados.", "reservation_expired");
  }
}

/**
 * Antes de iniciar un intento nuevo: concilia los intentos no finales con el proveedor.
 * Si alguno sigue en curso, no se permite otro cobro (evita dos cobros silenciosos).
 */
async function settleInFlight(order: Order, gw: PaymentGateway, exceptKey?: string) {
  const attempts = await db.select().from(paymentAttempts).where(and(eq(paymentAttempts.orderId, order.id), inArray(paymentAttempts.status, IN_FLIGHT)));
  for (const a of attempts) {
    if (a.idempotencyKey === exceptKey) continue;
    if (a.method === "wallet" && a.statusDetail === "preference_created") {
      // Preferencia sin pagos: verificar y vencerla antes de cambiar de método.
      const pays = await gw.findPaymentsByExternalReference(a.id).catch(() => null);
      if (pays === null) throw new PaymentFlowError("No pudimos verificar un intento anterior con Mercado Pago. Probá de nuevo en unos minutos.", "in_flight");
      if (pays.length === 0) {
        if (a.providerRef) await gw.expirePreference(a.providerRef).catch(() => null);
        await db.update(paymentAttempts).set({ status: "cancelled", statusDetail: "preference_expired_method_change", updatedAt: new Date() }).where(eq(paymentAttempts.id, a.id));
        continue;
      }
      await applyProviderState(a.id, { kind: "payments", providerRef: a.providerRef, status: aggregatePayments(pays), statusDetail: null, externalReference: a.id, amountCents: null, currency: pays[0]?.currency ?? null, collectorId: pays[0]?.collectorId ?? null, payments: pays, challengeUrl: null }, "reconcile");
    } else {
      await reconcileAttempt(a.id).catch(() => null);
    }
  }
  const [fresh] = await db.select().from(orders).where(eq(orders.id, order.id));
  if (PAID.includes(fresh.paymentStatus as InternalPaymentStatus)) throw new PaymentFlowError("Este pedido ya está pagado.", "already_paid");
  const still = await db.select().from(paymentAttempts).where(and(eq(paymentAttempts.orderId, order.id), inArray(paymentAttempts.status, IN_FLIGHT)));
  const blocking = still.filter((a) => a.idempotencyKey !== exceptKey && !(a.method === "wallet" && a.statusDetail === "preference_created"));
  if (blocking.length) {
    throw new PaymentFlowError(
      blocking[0].status === "requires_action"
        ? "Hay un pago esperando la autenticación de tu banco. Completala o esperá unos minutos antes de reintentar."
        : "Hay un pago en proceso para este pedido. Esperá la confirmación antes de intentar otro medio.",
      "in_flight",
    );
  }
}

export type CardSubmission = {
  idempotencyKey: string;
  token: string;
  paymentMethodId: string;
  paymentTypeId: string;
  issuerId?: string | null;
  installments: number;
  transactionAmount: number; // lo que el Brick mostró (se compara con el total del pedido)
  payerEmail: string;
  identification?: { type: string; number: string } | null;
};

export type PaymentOutcome = {
  attemptId: string;
  status: InternalPaymentStatus;
  orderPaymentStatus: string;
  message: string;
  challengeUrl: string | null;
};

function outcomeMessage(status: InternalPaymentStatus, detail: string | null): string {
  switch (status) {
    case "approved":
      return "¡Pago aprobado! Te enviamos la confirmación por email.";
    case "pending":
      return "Tu pago está en proceso. Te avisamos cuando Mercado Pago lo confirme.";
    case "requires_action":
      return "Tu banco pide una verificación adicional para completar el pago.";
    case "rejected":
      return rejectionMessage(detail);
    case "to_verify":
      return "No recibimos respuesta a tiempo. Estamos verificando el estado del pago con Mercado Pago: no vuelvas a pagar todavía.";
    default:
      return "El pago no se completó.";
  }
}

export async function startCardPayment(orderId: string, sub: CardSubmission): Promise<PaymentOutcome> {
  const gw = await requireGateway().catch(() => {
    throw new PaymentFlowError("Los pagos no están configurados en este momento.", "config", 503);
  });
  // Reintento idempotente: misma clave → mismo intento, sin volver a cobrar.
  const [again] = await db.select().from(paymentAttempts).where(eq(paymentAttempts.idempotencyKey, sub.idempotencyKey));
  if (again) {
    if (again.orderId !== orderId) throw new PaymentFlowError("Clave de pago inválida.", "not_payable", 400);
    if (IN_FLIGHT.includes(again.status as InternalPaymentStatus)) await reconcileAttempt(again.id).catch(() => null);
    return describeAttempt(again.id);
  }

  const [order] = await db.select().from(orders).where(eq(orders.id, orderId));
  if (!order) throw new PaymentFlowError("Pedido inexistente.", "not_payable", 404);
  await assertPayable(order);
  if (Math.round(sub.transactionAmount * 100) !== order.totalCents) {
    throw new PaymentFlowError("El importe del formulario no coincide con el total del pedido. Recargá la página para ver el total actualizado.", "amount_changed");
  }
  await settleInFlight(order, gw);

  let attempt: Attempt;
  try {
    [attempt] = await db
      .insert(paymentAttempts)
      .values({
        orderId,
        method: "card",
        driver: gw.driver,
        environment: gw.environment,
        idempotencyKey: sub.idempotencyKey,
        amountCents: order.totalCents,
        status: "pending",
        installments: sub.installments,
        paymentMethodId: sub.paymentMethodId,
      })
      .returning();
  } catch {
    // Carrera de doble clic con la misma clave.
    const [a] = await db.select().from(paymentAttempts).where(eq(paymentAttempts.idempotencyKey, sub.idempotencyKey));
    return describeAttempt(a.id);
  }
  await db.update(orders).set({ paymentStatus: "pending", updatedAt: new Date() }).where(eq(orders.id, orderId));

  try {
    const state = await gw.createCardOrder({
      externalReference: attempt.id,
      idempotencyKey: sub.idempotencyKey,
      amountCents: order.totalCents,
      token: sub.token,
      paymentMethodId: sub.paymentMethodId,
      paymentTypeId: sub.paymentTypeId,
      installments: sub.installments,
      payerEmail: sub.payerEmail || order.email,
      payerIdentification: sub.identification ?? null,
      description: `Chulada Kids ${orderNumber(order.number)}`,
    });
    await applyProviderState(attempt.id, state, "create");
  } catch (e) {
    if (e instanceof GatewayRejectedError) {
      const found = await gw.findOrderByExternalReference(attempt.id, attempt.createdAt).catch(() => null);
      if (found) await applyProviderState(attempt.id, found, "create");
      else await setAttempt(attempt.id, { status: "rejected", statusDetail: e.detail, errorCode: "402" });
    } else if (e instanceof GatewayTimeoutError) {
      await setAttempt(attempt.id, { status: "to_verify", statusDetail: "timeout", errorCode: "timeout" });
      await reconcileAttempt(attempt.id).catch(() => null);
    } else if (e instanceof GatewayAuthError) {
      await markConnectionRevoked(e.message);
      await setAttempt(attempt.id, { status: "cancelled", statusDetail: "credentials_invalid", errorCode: "401" });
    } else {
      // Error desconocido: no asumimos rechazo; queda por verificar y lo resuelve la conciliación.
      await setAttempt(attempt.id, { status: "to_verify", statusDetail: String((e as Error).message).slice(0, 120), errorCode: "unknown" });
    }
    await syncOrderFromAttempts(orderId);
  }
  return describeAttempt(attempt.id);
}

export async function startWalletPayment(orderId: string, idempotencyKey: string) {
  const gw = await requireGateway().catch(() => {
    throw new PaymentFlowError("Los pagos no están configurados en este momento.", "config", 503);
  });
  const [order] = await db.select().from(orders).where(eq(orders.id, orderId));
  if (!order) throw new PaymentFlowError("Pedido inexistente.", "not_payable", 404);
  await assertPayable(order);

  // Reutilizar una preferencia vigente de este pedido (volver de MP y reintentar no crea otra).
  const [existing] = await db
    .select()
    .from(paymentAttempts)
    .where(and(eq(paymentAttempts.orderId, orderId), eq(paymentAttempts.method, "wallet"), eq(paymentAttempts.statusDetail, "preference_created"), eq(paymentAttempts.status, "pending")))
    .orderBy(desc(paymentAttempts.createdAt))
    .limit(1);
  if (existing?.providerRef && existing.amountCents === order.totalCents) {
    await settleInFlight(order, gw, existing.idempotencyKey);
    return { preferenceId: existing.providerRef, attemptId: existing.id, driver: gw.driver };
  }
  await settleInFlight(order, gw);

  const [attempt] = await db
    .insert(paymentAttempts)
    .values({ orderId, method: "wallet", driver: gw.driver, environment: gw.environment, idempotencyKey, amountCents: order.totalCents, status: "pending", statusDetail: "creating_preference" })
    .onConflictDoNothing({ target: paymentAttempts.idempotencyKey })
    .returning();
  if (!attempt) {
    const [a] = await db.select().from(paymentAttempts).where(eq(paymentAttempts.idempotencyKey, idempotencyKey));
    if (a?.providerRef) return { preferenceId: a.providerRef, attemptId: a.id, driver: gw.driver };
    throw new PaymentFlowError("Estamos preparando el pago. Probá de nuevo en unos segundos.", "in_flight");
  }
  try {
    const pref = await gw.createPreference({
      externalReference: attempt.id,
      idempotencyKey,
      amountCents: order.totalCents,
      title: `Chulada Kids — pedido ${orderNumber(order.number)}`,
      payerEmail: order.email,
      backUrl: `${env.appUrl}/checkout/resultado?pedido=${order.id}&intento=${attempt.id}`,
      notificationUrl: `${env.appUrl}/api/webhooks/mercadopago?source_news=webhooks`,
      expiresAt: order.reservationExpiresAt ?? new Date(Date.now() + env.reservationMinutes * 60_000),
    });
    await db.update(paymentAttempts).set({ providerRef: pref.preferenceId, statusDetail: "preference_created", updatedAt: new Date() }).where(eq(paymentAttempts.id, attempt.id));
    return { preferenceId: pref.preferenceId, attemptId: attempt.id, driver: gw.driver };
  } catch (e) {
    await setAttempt(attempt.id, { status: "cancelled", statusDetail: "preference_failed", errorCode: e instanceof GatewayAuthError ? "401" : "error" });
    if (e instanceof GatewayAuthError) await markConnectionRevoked(e.message);
    throw new PaymentFlowError("No pudimos iniciar el pago con Mercado Pago. Probá de nuevo o elegí tarjeta.", "config", 502);
  }
}

async function setAttempt(id: string, patch: Partial<Attempt>) {
  await db.update(paymentAttempts).set({ ...patch, updatedAt: new Date() }).where(eq(paymentAttempts.id, id));
}

export async function describeAttempt(attemptId: string): Promise<PaymentOutcome> {
  const [a] = await db.select().from(paymentAttempts).where(eq(paymentAttempts.id, attemptId));
  const [o] = await db.select().from(orders).where(eq(orders.id, a.orderId));
  return { attemptId: a.id, status: a.status as InternalPaymentStatus, orderPaymentStatus: o.paymentStatus, message: outcomeMessage(a.status as InternalPaymentStatus, a.statusDetail), challengeUrl: a.status === "requires_action" ? a.challengeUrl : null };
}

/** Recalcula el estado de pago del pedido a partir de sus intentos (cuando ningún pago se aplicó). */
async function syncOrderFromAttempts(orderId: string, tx: Tx | typeof db = db) {
  const [o] = await tx.select().from(orders).where(eq(orders.id, orderId));
  if (PAID.includes(o.paymentStatus as InternalPaymentStatus)) return;
  const attempts = await tx.select().from(paymentAttempts).where(eq(paymentAttempts.orderId, orderId)).orderBy(desc(paymentAttempts.createdAt));
  const real = attempts.filter((a) => !(a.method === "wallet" && a.statusDetail === "preference_created"));
  let next: Order["paymentStatus"] = "unpaid";
  if (real.some((a) => a.status === "to_verify")) next = "to_verify";
  else if (real.some((a) => a.status === "requires_action")) next = "requires_action";
  else if (real.some((a) => a.status === "pending")) next = "pending";
  else if (real[0]?.status === "rejected") next = "rejected";
  else if (o.paymentStatus === "expired") next = "expired";
  if (next !== o.paymentStatus) {
    await tx.update(orders).set({ paymentStatus: next, updatedAt: new Date() }).where(eq(orders.id, orderId));
    await tx.insert(orderEvents).values({ orderId, type: "payment_status", fromValue: o.paymentStatus, toValue: next });
  }
}

/**
 * Aplica un estado del proveedor ya obtenido de su API (nunca de parámetros de retorno).
 * Idempotente y seguro ante eventos repetidos o fuera de orden: bloquea pedido e intento,
 * verifica moneda, cuenta receptora, importe y referencia, y aprueba el pedido una sola vez.
 */
export async function applyProviderState(attemptId: string, state: ProviderState, source: "create" | "webhook" | "reconcile" | "return") {
  const gw = await getGateway();
  const expectedCollector = gw?.collectorId ?? null;
  await db.transaction(async (tx) => {
    const [attempt] = await tx.select().from(paymentAttempts).where(eq(paymentAttempts.id, attemptId)).for("update");
    if (!attempt) throw new Error(`Intento ${attemptId} inexistente`);
    const [order] = await tx.select().from(orders).where(eq(orders.id, attempt.orderId)).for("update");

    const problems: string[] = [];
    if (state.externalReference && state.externalReference !== attempt.id) problems.push(`referencia ${state.externalReference} ≠ ${attempt.id}`);
    for (const p of state.payments) {
      if (p.currency && p.currency !== "ARS") problems.push(`moneda ${p.currency}`);
      if (expectedCollector && p.collectorId && p.collectorId !== expectedCollector) problems.push(`cuenta receptora ${p.collectorId} ≠ ${expectedCollector}`);
      if (PAID.includes(p.status) && p.amountCents !== attempt.amountCents) problems.push(`importe ${p.amountCents} ≠ ${attempt.amountCents}`);
    }
    if (state.currency && state.currency !== "ARS") problems.push(`moneda de la order ${state.currency}`);

    // Registrar pagos (únicos por id del proveedor).
    for (const p of state.payments) {
      await tx
        .insert(payments)
        .values({
          orderId: order.id,
          attemptId: attempt.id,
          providerPaymentId: p.providerPaymentId,
          status: p.status,
          statusDetail: p.statusDetail,
          amountCents: p.amountCents,
          refundedCents: p.refundedCents,
          currency: p.currency || "ARS",
          collectorId: p.collectorId,
        })
        .onConflictDoUpdate({
          target: payments.providerPaymentId,
          set: { status: p.status, statusDetail: p.statusDetail, refundedCents: p.refundedCents, updatedAt: new Date() },
        });
    }

    const attemptStatus = state.kind === "payments" ? aggregatePayments(state.payments) : state.status;
    const nextAttemptStatus: InternalPaymentStatus = problems.length && PAID.includes(attemptStatus) ? "to_verify" : attemptStatus;
    await tx
      .update(paymentAttempts)
      .set({
        status: nextAttemptStatus,
        statusDetail: state.kind === "payments" && state.payments.length === 0 ? attempt.statusDetail : (state.statusDetail ?? state.payments[0]?.statusDetail ?? attempt.statusDetail),
        providerRef: attempt.providerRef ?? state.providerRef,
        challengeUrl: state.challengeUrl ?? attempt.challengeUrl,
        installments: state.payments[0]?.installments ?? attempt.installments,
        lastCheckedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(paymentAttempts.id, attempt.id));

    if (problems.length) {
      const [dupInc] = await tx.select().from(incidents).where(and(eq(incidents.orderId, order.id), eq(incidents.kind, "amount_mismatch"), eq(incidents.status, "open")));
      if (!dupInc) await openIncident(tx, order, "amount_mismatch", { attemptId, problems, source });
      await tx.insert(orderEvents).values({ orderId: order.id, type: "payment_verification_failed", message: problems.join("; ") });
      return;
    }

    // Aprobaciones: se aplican al pedido una sola vez; pagos extra → incidencia.
    const paidRows = await tx.select().from(payments).where(eq(payments.orderId, order.id));
    for (const p of state.payments.filter((x) => PAID.includes(x.status))) {
      const row = paidRows.find((r) => r.providerPaymentId === p.providerPaymentId)!;
      if (row.appliedToOrder) continue;
      const alreadyPaid = paidRows.some((r) => r.appliedToOrder && r.providerPaymentId !== p.providerPaymentId);
      if (alreadyPaid || PAID.includes(order.paymentStatus as InternalPaymentStatus)) {
        const [dup] = await tx.select().from(incidents).where(and(eq(incidents.orderId, order.id), eq(incidents.kind, "duplicate_payment"), sql`${incidents.details}->>'paymentId' = ${p.providerPaymentId}`));
        if (!dup) await openIncident(tx, order, "duplicate_payment", { paymentId: p.providerPaymentId, amountCents: p.amountCents, attemptId, note: "Pago adicional para un pedido ya pagado: revisar y reembolsar." });
        continue;
      }
      await approveOrder(tx, order, row.id, source);
      order.paymentStatus = "approved";
    }

    // Reembolsos y contracargos sobre el pago aplicado.
    const applied = await tx.select().from(payments).where(and(eq(payments.orderId, order.id), eq(payments.appliedToOrder, true)));
    if (applied.length) {
      const main = applied[0];
      let next: Order["paymentStatus"] = "approved";
      if (main.status === "charged_back") next = "charged_back";
      else if (main.refundedCents >= main.amountCents || main.status === "refunded") next = "refunded";
      else if (main.refundedCents > 0 || main.status === "partially_refunded") next = "partially_refunded";
      if (next !== order.paymentStatus) {
        await tx.update(orders).set({ paymentStatus: next, updatedAt: new Date() }).where(eq(orders.id, order.id));
        await tx.insert(orderEvents).values({ orderId: order.id, type: "payment_status", fromValue: order.paymentStatus, toValue: next, message: `Fuente: ${source}` });
        if (next === "charged_back") await openIncident(tx, order, "other", { note: "Contracargo informado por el proveedor.", paymentId: main.providerPaymentId });
      }
      return;
    }

    // Sin pago aplicado: pendiente extiende la reserva (sin exceder el plazo máximo de retención).
    if (attemptStatus === "pending") {
      const due = state.payments.map((p) => p.dateOfExpiration).find(Boolean) ?? null;
      const cap = new Date(Date.now() + env.pendingHoldHours * 3600_000);
      const until = due && due < cap ? due : cap;
      await extendReservations(tx, order.id, until);
      await tx.update(orders).set({ reservationExpiresAt: until }).where(and(eq(orders.id, order.id), lt(orders.reservationExpiresAt, until)));
    }
    await syncOrderFromAttempts(order.id, tx);
  });
}

async function approveOrder(tx: Tx, order: Order, paymentRowId: string, source: string) {
  const lines = await tx.select().from(orderLines).where(eq(orderLines.orderId, order.id));
  const variantIds = lines.map((l) => l.variantId).filter((v): v is string => !!v);
  const backorder = new Map<string, boolean>();
  if (variantIds.length) {
    const rows = await tx
      .select({ id: productVariants.id, allow: products.allowBackorder })
      .from(productVariants)
      .innerJoin(products, eq(products.id, productVariants.productId))
      .where(inArray(productVariants.id, variantIds));
    for (const r of rows) backorder.set(r.id, r.allow);
  }
  const shortages = await consumeForApprovedOrder(tx, order.id, backorder);
  await tx.update(payments).set({ appliedToOrder: true, updatedAt: new Date() }).where(eq(payments.id, paymentRowId));
  await tx
    .update(orders)
    .set({ paymentStatus: "approved", paidAt: new Date(), fulfillmentStatus: order.fulfillmentStatus === "awaiting_payment" ? "received" : order.fulfillmentStatus, updatedAt: new Date() })
    .where(eq(orders.id, order.id));
  await tx.update(couponRedemptions).set({ status: "used", updatedAt: new Date() }).where(eq(couponRedemptions.orderId, order.id));
  await tx.insert(orderEvents).values({ orderId: order.id, type: "payment_status", fromValue: order.paymentStatus, toValue: "approved", message: `Pago aprobado (fuente: ${source}).` });
  if (shortages.length) {
    await openIncident(tx, order, "late_approval_no_stock", { shortages, note: "Pago aprobado después de vencer la reserva y sin stock suficiente: resolver (reasignar, producir o reembolsar). No prometer entrega." });
  }
  // Vaciar el carrito si no cambió después de crear el pedido.
  if (order.cartId) {
    const [cart] = await tx.select().from(carts).where(eq(carts.id, order.cartId));
    if (cart && cart.updatedAt <= order.createdAt) {
      await tx.delete(cartLines).where(eq(cartLines.cartId, cart.id));
      await tx.update(carts).set({ couponCode: null }).where(eq(carts.id, cart.id));
    }
  }
  const number = orderNumber(order.number);
  const customer = orderPaidCustomerEmail(
    { number, name: order.customerName, totalCents: order.totalCents, link: orderLink(order.id), shippingName: order.shipping.name, productionDaysMax: order.productionDaysMax },
    lines,
  );
  await enqueueEmail({ dedupeKey: `order-paid:${order.id}`, to: order.email, ...customer }, tx);
  await enqueueEmail({ dedupeKey: `order-paid-admin:${order.id}`, to: await adminEmail(), ...orderPaidAdminEmail({ number, name: order.customerName, email: order.email, totalCents: order.totalCents, adminLink: `${env.appUrl}/admin/pedidos/${order.id}` }) }, tx);
  await tx.update(orders).set({ confirmationSentAt: null }).where(eq(orders.id, order.id));
  await recordEvent("purchase", { orderId: order.id, valueCents: order.totalCents, dedupeKey: `purchase:${order.id}` });
}

/** Consulta al proveedor el estado actual de un intento y lo aplica. */
export async function reconcileAttempt(attemptId: string) {
  const gw = await requireGateway();
  const [a] = await db.select().from(paymentAttempts).where(eq(paymentAttempts.id, attemptId));
  if (!a) return;
  if (a.method === "card") {
    const state = a.providerRef ? await gw.getOrder(a.providerRef) : await gw.findOrderByExternalReference(a.id, a.createdAt);
    if (state) await applyProviderState(a.id, state, "reconcile");
    else if (a.status === "to_verify" && Date.now() - a.createdAt.getTime() > 30 * 60_000) {
      // Sin rastro en el proveedor tras 30 minutos: no hubo cobro.
      await setAttempt(a.id, { status: "cancelled", statusDetail: "not_found_at_provider", lastCheckedAt: new Date() });
      await syncOrderFromAttempts(a.orderId);
    } else await setAttempt(a.id, { lastCheckedAt: new Date() });
  } else {
    const pays = await gw.findPaymentsByExternalReference(a.id);
    if (pays.length) await applyProviderState(a.id, { kind: "payments", providerRef: a.providerRef, status: aggregatePayments(pays), statusDetail: null, externalReference: a.id, amountCents: null, currency: null, collectorId: null, payments: pays, challengeUrl: null }, "reconcile");
    else await setAttempt(a.id, { lastCheckedAt: new Date() });
  }
}

/** Para la pantalla de resultado: si hay intentos en curso, verifica con el proveedor antes de responder. */
export async function refreshOrderPayment(orderId: string) {
  const attempts = await db
    .select()
    .from(paymentAttempts)
    .where(and(eq(paymentAttempts.orderId, orderId), or(inArray(paymentAttempts.status, IN_FLIGHT), eq(paymentAttempts.statusDetail, "preference_created"))));
  for (const a of attempts) {
    if (a.lastCheckedAt && Date.now() - a.lastCheckedAt.getTime() < 5000) continue;
    await reconcileAttempt(a.id).catch(() => null);
  }
}

// ───────────── Reembolsos y cancelaciones (solo propietario) ─────────────

export async function refundOrderPayment(orderId: string, amountCents: number | null, actorUserId: string) {
  const gw = await requireGateway();
  const [p] = await db.select().from(payments).where(and(eq(payments.orderId, orderId), eq(payments.appliedToOrder, true)));
  if (!p || !FINAL_OK.includes(p.status as InternalPaymentStatus)) throw new GatewayConfigError("El pedido no tiene un pago aprobado para reembolsar.");
  const remaining = p.amountCents - p.refundedCents;
  if (amountCents !== null && (amountCents <= 0 || amountCents > remaining)) throw new GatewayConfigError(`El monto debe estar entre $ 0,01 y ${remaining / 100}.`);
  const [attempt] = p.attemptId ? await db.select().from(paymentAttempts).where(eq(paymentAttempts.id, p.attemptId)) : [];
  await db.insert(orderEvents).values({ orderId, type: "refund_requested", message: `Reembolso ${amountCents === null ? "total" : amountCents / 100} solicitado al proveedor.`, actorUserId });
  if (attempt?.method === "card" && attempt.providerRef) {
    const state = await gw.refundOrder(attempt.providerRef, amountCents, p.providerPaymentId);
    await applyProviderState(attempt.id, state, "reconcile");
  } else {
    const updated = await gw.refundPayment(p.providerPaymentId, amountCents);
    if (attempt) await applyProviderState(attempt.id, { kind: "payments", providerRef: attempt.providerRef, status: updated.status, statusDetail: updated.statusDetail, externalReference: attempt.id, amountCents: null, currency: updated.currency, collectorId: updated.collectorId, payments: [updated], challengeUrl: null }, "reconcile");
  }
}

export async function paymentHistory(orderId: string) {
  return {
    attempts: await db.select().from(paymentAttempts).where(eq(paymentAttempts.orderId, orderId)).orderBy(desc(paymentAttempts.createdAt)),
    payments: await db.select().from(payments).where(eq(payments.orderId, orderId)).orderBy(desc(payments.createdAt)),
  };
}

export { GatewayConfigError };
