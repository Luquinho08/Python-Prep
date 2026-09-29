import "server-only";
import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import {
  carts,
  couponRedemptions,
  coupons,
  orderEvents,
  orderLines,
  orders,
  paymentAttempts,
  products,
  productVariants,
  shippingMethods,
  stockReservations,
  type OrderAddress,
  type ShippingSnapshot,
} from "../db/schema";
import { env } from "../env";
import { loadRawLines } from "../cart/service";
import { priceLines, type CartLineView } from "../cart/pricing";
import { normalizePostalCode, postalCodeMatches } from "../shipping";
import { checkoutReadinessProblems, getStoreSettings } from "../content/settings";
import { getGateway } from "../payments/connection";
import { IN_FLIGHT } from "../payments/status";
import type { Totals } from "../pricing/engine";
import { activeReserved, lockVariants, releaseReservations } from "./reservations";
import { orderAccessHash, orderAccessToken, orderNumber } from "./access";
import { recordEvent } from "../analytics";

export const checkoutSchema = z.object({
  checkoutKey: z.string().uuid(),
  name: z.string().trim().min(2, "Ingresá tu nombre y apellido.").max(80),
  email: z.string().trim().toLowerCase().email("Ingresá un email válido.").max(160),
  phone: z
    .string()
    .trim()
    .min(8, "Ingresá un teléfono de contacto.")
    .max(30)
    .regex(/^[+\d\s()-]+$/, "Usá solo números, espacios y +."),
  postalCode: z.string().trim().max(10),
  shippingMethodId: z.string().uuid("Elegí un método de entrega."),
  street: z.string().trim().max(120).optional(),
  number: z.string().trim().max(20).optional(),
  apartment: z.string().trim().max(40).optional(),
  city: z.string().trim().max(80).optional(),
  province: z.string().trim().max(80).optional(),
  addressNotes: z.string().trim().max(200).optional(),
  notes: z.string().trim().max(500).optional(),
  acceptTerms: z.literal(true, { message: "Tenés que aceptar los términos y condiciones." }),
  expectedTotalCents: z.number().int().nullable(),
});
export type CheckoutInput = z.infer<typeof checkoutSchema>;

export type CheckoutSummary = {
  lines: { id: string; name: string; variant: string; quantity: number; packUnits: number; unitLabel: string; personalization: { label: string; display: string }[]; lineTotalCents: number; lineRegularCents: number }[];
  subtotalCents: number;
  promotionDiscountCents: number;
  couponDiscountCents: number;
  couponCode: string | null;
  couponMessage: string | null;
  shippingCents: number;
  shippingName: string;
  totalCents: number;
  productionDaysMax: number;
  deliveryDaysMin: number;
  deliveryDaysMax: number;
};

export type CheckoutResult =
  | { ok: true; orderId: string; orderNumber: string; accessToken: string; summary: CheckoutSummary; reservationExpiresAt: string }
  | { ok: false; kind: "changed"; message: string; summary: CheckoutSummary }
  | { ok: false; kind: "error"; message: string; fieldErrors?: Record<string, string>; pendingOrderId?: string };

class Changed extends Error {
  constructor(public summary: CheckoutSummary) {
    super("changed");
  }
}
class Existing extends Error {
  constructor(public orderId: string) {
    super("existing");
  }
}
class Refuse extends Error {
  constructor(
    message: string,
    public pendingOrderId?: string,
  ) {
    super(message);
  }
}

export async function availableShippingMethods(postalCodeRaw: string) {
  const cp = normalizePostalCode(postalCodeRaw);
  const methods = await db.select().from(shippingMethods).where(eq(shippingMethods.isActive, true)).orderBy(asc(shippingMethods.sort));
  return {
    postalCode: cp,
    methods: methods
      .filter((m) => m.kind === "pickup" || (cp !== null && postalCodeMatches(m.postalCodes, cp)))
      .map((m) => ({ id: m.id, name: m.name, kind: m.kind, description: m.description, priceCents: m.priceCents, deliveryDaysMin: m.deliveryDaysMin, deliveryDaysMax: m.deliveryDaysMax })),
    hasDelivery: methods.some((m) => m.kind === "delivery"),
  };
}

function buildSummary(lines: CartLineView[], totals: Totals, ship: ShippingSnapshot | null): CheckoutSummary {
  return {
    lines: lines.map((l) => ({
      id: l.id,
      name: l.productName,
      variant: l.variantName,
      quantity: l.quantity,
      packUnits: l.packUnits,
      unitLabel: l.unitLabel,
      personalization: l.personalization.map((p) => ({ label: p.label, display: p.display })),
      lineTotalCents: l.lineTotalCents,
      lineRegularCents: l.lineRegularCents,
    })),
    subtotalCents: totals.subtotalCents,
    promotionDiscountCents: totals.promotionDiscountCents,
    couponDiscountCents: totals.couponDiscountCents,
    couponCode: totals.coupon?.ok ? totals.coupon.code : null,
    couponMessage: totals.coupon?.message ?? null,
    shippingCents: totals.shippingCents,
    shippingName: ship?.name ?? "",
    totalCents: totals.totalCents,
    productionDaysMax: Math.max(0, ...lines.map((l) => l.productionDaysMax)),
    deliveryDaysMin: ship?.deliveryDaysMin ?? 0,
    deliveryDaysMax: ship?.deliveryDaysMax ?? 0,
  };
}

/**
 * Crea el pedido pendiente con precios, promociones, cupón, envío y stock calculados en el servidor.
 * Idempotente por checkoutKey. Bloquea variantes y cupón para evitar sobreventa y doble uso.
 */
export async function createOrderFromCart(input: CheckoutInput, ctx: { cartId: string; userId: string | null }): Promise<CheckoutResult> {
  // Idempotencia: la misma clave devuelve el mismo pedido.
  const [existing] = await db.select().from(orders).where(eq(orders.checkoutKey, input.checkoutKey));
  if (existing) {
    if (existing.cartId !== ctx.cartId) return { ok: false, kind: "error", message: "Clave de compra inválida. Recargá la página." };
    const summary = await summaryFromOrder(existing.id);
    return { ok: true, orderId: existing.id, orderNumber: orderNumber(existing.number), accessToken: orderAccessToken(existing.id), summary, reservationExpiresAt: (existing.reservationExpiresAt ?? new Date()).toISOString() };
  }

  const settings = await getStoreSettings();
  const problems = checkoutReadinessProblems(settings);
  if (problems.length) return { ok: false, kind: "error", message: problems.join(" ") };
  if (!(await getGateway())) return { ok: false, kind: "error", message: "Los pagos todavía no están configurados. No es posible comprar en este momento." };

  const [method] = await db.select().from(shippingMethods).where(and(eq(shippingMethods.id, input.shippingMethodId), eq(shippingMethods.isActive, true)));
  if (!method) return { ok: false, kind: "error", message: "El método de entrega ya no está disponible.", fieldErrors: { shippingMethodId: "Elegí otro método." } };
  let address: OrderAddress | null = null;
  if (method.kind === "delivery") {
    const cp = normalizePostalCode(input.postalCode);
    if (!cp || !postalCodeMatches(method.postalCodes, cp)) return { ok: false, kind: "error", message: "Ese método no llega a tu código postal.", fieldErrors: { postalCode: "Sin cobertura para este método." } };
    const fe: Record<string, string> = {};
    if (!input.street) fe.street = "Ingresá la calle.";
    if (!input.number) fe.number = "Ingresá la altura.";
    if (!input.city) fe.city = "Ingresá la localidad.";
    if (!input.province) fe.province = "Ingresá la provincia.";
    if (Object.keys(fe).length) return { ok: false, kind: "error", message: "Completá la dirección de entrega.", fieldErrors: fe };
    address = { street: input.street!, number: input.number!, apartment: input.apartment, city: input.city!, province: input.province!, postalCode: cp, notes: input.addressNotes };
  }
  const shipping: ShippingSnapshot = {
    methodId: method.id,
    name: method.name,
    kind: method.kind,
    priceCents: method.priceCents,
    deliveryDaysMin: method.deliveryDaysMin,
    deliveryDaysMax: method.deliveryDaysMax,
    description: method.description,
  };

  const raw = await loadRawLines(ctx.cartId);
  if (raw.length === 0) return { ok: false, kind: "error", message: "Tu carrito está vacío." };
  const [cart] = await db.select().from(carts).where(eq(carts.id, ctx.cartId));
  const customerKey = input.email;

  try {
    const result = await db.transaction(async (tx) => {
      // 0) Serializa los checkouts del mismo carrito y vuelve a buscar la clave: un doble envío
      //    concurrente espera al primero y recibe el mismo pedido (no "agotado" ni un duplicado).
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`checkout:${ctx.cartId}`}))`);
      const [dup] = await tx.select().from(orders).where(eq(orders.checkoutKey, input.checkoutKey));
      if (dup) throw new Existing(dup.id);

      // 1) Pedidos previos del mismo carrito: si hay un pago en curso, no se crea otro (evita doble cobro).
      const previous = await tx
        .select()
        .from(orders)
        .where(and(eq(orders.cartId, ctx.cartId), isNull(orders.supersededBy), inArray(orders.paymentStatus, ["unpaid", "pending", "requires_action", "to_verify", "rejected", "cancelled", "expired"])))
        .for("update");
      for (const prev of previous) {
        const inflight = await tx
          .select()
          .from(paymentAttempts)
          .where(and(eq(paymentAttempts.orderId, prev.id), inArray(paymentAttempts.status, IN_FLIGHT)));
        if (inflight.some((a) => a.method === "card" || a.statusDetail !== "preference_created")) {
          throw new Refuse(`Hay un pago en proceso para el pedido ${orderNumber(prev.number)}. Esperá su confirmación antes de volver a pagar.`, prev.id);
        }
      }

      // 2) Bloqueos: variantes (stock) y cupón (usos).
      const variantIds = raw.map((l) => l.variantId);
      const stock = await lockVariants(tx, variantIds);
      if (cart?.couponCode) await tx.select().from(coupons).where(eq(coupons.code, cart.couponCode)).for("update");

      // Liberar lo reservado por pedidos previos sin pagar de este carrito (se reemplazan).
      for (const prev of previous) {
        await releaseReservations(tx, prev.id);
        await tx.update(couponRedemptions).set({ status: "released", updatedAt: new Date() }).where(and(eq(couponRedemptions.orderId, prev.id), eq(couponRedemptions.status, "reserved")));
      }

      // 3) Precios definitivos dentro de la transacción.
      const priced = await priceLines({ lines: raw, couponCode: cart?.couponCode, customerKey, shippingCents: shipping.priceCents, tx, excludeOrderId: null });
      const summary = buildSummary(priced.lines, priced.totals, shipping);
      const issue = priced.lines.find((l) => l.issue && l.issue.kind !== "insufficient");
      if (issue) throw new Refuse(`${issue.productName}: ${issue.issue!.message}`);
      if (cart?.couponCode && priced.totals.coupon && !priced.totals.coupon.ok) throw new Refuse(`Cupón: ${priced.totals.coupon.message} Quitalo desde el carrito para continuar.`);

      // 4) Disponibilidad con bloqueo (dos compradores del último stock: solo uno reserva).
      const reserved = await activeReserved(tx, variantIds);
      const need = new Map<string, number>();
      for (const l of raw) need.set(l.variantId, (need.get(l.variantId) ?? 0) + l.quantity);
      const prods = await tx.select({ id: products.id, allowBackorder: products.allowBackorder }).from(products).where(inArray(products.id, raw.map((l) => l.productId)));
      const variants = await tx.select({ id: productVariants.id, productId: productVariants.productId }).from(productVariants).where(inArray(productVariants.id, variantIds));
      for (const [variantId, qty] of need) {
        const productId = variants.find((v) => v.id === variantId)?.productId;
        const backorder = prods.find((p) => p.id === productId)?.allowBackorder ?? false;
        const available = (stock.get(variantId) ?? 0) - (reserved.get(variantId) ?? 0);
        if (!backorder && available < qty) {
          const line = priced.lines.find((l) => l.variantId === variantId);
          throw new Refuse(available > 0 ? `${line?.productName} (${line?.variantName}): solo quedan ${available} disponibles. Ajustá la cantidad en el carrito.` : `${line?.productName} (${line?.variantName}) se agotó mientras comprabas. Quitalo del carrito para continuar.`);
        }
      }

      // 5) El total que se va a cobrar debe ser el que la persona revisó.
      if (input.expectedTotalCents === null || input.expectedTotalCents !== priced.totals.totalCents) throw new Changed(summary);

      // 6) Crear pedido con snapshot completo.
      const reservationExpiresAt = new Date(Date.now() + env.reservationMinutes * 60_000);
      const eventDate = priced.lines.flatMap((l) => l.personalization).find((p) => /^\d{4}-\d{2}-\d{2}$/.test(p.value) && /fecha/i.test(p.label))?.value ?? null;
      const newId = randomUUID();
      const [order] = await tx
        .insert(orders)
        .values({
          id: newId,
          checkoutKey: input.checkoutKey,
          accessTokenHash: orderAccessHash(newId),
          userId: ctx.userId,
          cartId: ctx.cartId,
          email: input.email,
          customerName: input.name,
          phone: input.phone,
          shipping,
          address,
          subtotalCents: priced.totals.subtotalCents,
          promotionDiscountCents: priced.totals.promotionDiscountCents,
          couponDiscountCents: priced.totals.couponDiscountCents,
          shippingCents: priced.totals.shippingCents,
          totalCents: priced.totals.totalCents,
          couponCode: priced.totals.coupon?.ok ? priced.totals.coupon.code : null,
          pricingSnapshot: { totals: priced.totals, computedAt: new Date().toISOString() },
          paymentStatus: "unpaid",
          fulfillmentStatus: "awaiting_payment",
          termsVersion: env.termsVersion,
          termsAcceptedAt: new Date(),
          customerNotes: input.notes || null,
          reservationExpiresAt,
          productionDaysMax: summary.productionDaysMax,
          eventDate,
        })
        .returning();

      await tx.insert(orderLines).values(
        priced.lines.map((l) => ({
          orderId: order.id,
          productId: l.productId,
          variantId: l.variantId,
          productName: l.productName,
          variantName: l.variantName,
          sku: l.sku,
          quantity: l.quantity,
          packUnits: l.packUnits,
          unitLabel: l.unitLabel,
          regularUnitPriceCents: l.regularUnitCents,
          unitPriceCents: l.regularUnitCents - l.unitPromotionDiscountCents,
          surchargeUnitCents: l.surchargeUnitCents,
          promotionDiscountCents: l.promotionDiscountCents,
          couponDiscountCents: l.couponDiscountCents,
          lineTotalCents: l.lineTotalCents,
          personalization: l.personalization,
          appliedPromotions: l.appliedPromotions,
          requiresDesignApproval: l.requiresDesignApproval,
          inventoryMode: l.inventoryMode,
          productionDaysMax: l.productionDaysMax,
        })),
      );
      await tx.insert(stockReservations).values([...need].map(([variantId, quantity]) => ({ orderId: order.id, variantId, quantity, expiresAt: reservationExpiresAt })));
      if (priced.totals.coupon?.ok && cart?.couponCode) {
        const [c] = await tx.select().from(coupons).where(eq(coupons.code, cart.couponCode));
        await tx.insert(couponRedemptions).values({ couponId: c.id, orderId: order.id, customerKey, status: "reserved", reservedUntil: reservationExpiresAt });
      }
      for (const prev of previous) {
        await tx.update(orders).set({ supersededBy: order.id, updatedAt: new Date() }).where(eq(orders.id, prev.id));
        await tx.insert(orderEvents).values({ orderId: prev.id, type: "superseded", message: `Reemplazado por ${orderNumber(order.number)} (datos o carrito editados).` });
      }
      await tx.insert(orderEvents).values({ orderId: order.id, type: "created", toValue: "unpaid", message: `Pedido creado. Total ${priced.totals.totalCents / 100} ARS. Reserva hasta ${reservationExpiresAt.toISOString()}.`, actorLabel: "cliente" });
      const walletPrefs = previous.length
        ? await tx
            .select({ ref: paymentAttempts.providerRef, id: paymentAttempts.id })
            .from(paymentAttempts)
            .where(and(inArray(paymentAttempts.orderId, previous.map((p) => p.id)), eq(paymentAttempts.method, "wallet"), eq(paymentAttempts.statusDetail, "preference_created")))
        : [];
      for (const w of walletPrefs) await tx.update(paymentAttempts).set({ status: "cancelled", statusDetail: "preference_expired_superseded", updatedAt: new Date() }).where(eq(paymentAttempts.id, w.id));
      return { order, summary, reservationExpiresAt, walletPrefs };
    });
    // Las preferencias de pedidos reemplazados se vencen en el proveedor para que no puedan pagarse.
    if (result.walletPrefs.length) {
      const gw = await getGateway();
      for (const w of result.walletPrefs) if (w.ref && gw) await gw.expirePreference(w.ref).catch(() => null);
    }
    await recordEvent("begin_checkout", { orderId: result.order.id });
    return {
      ok: true,
      orderId: result.order.id,
      orderNumber: orderNumber(result.order.number),
      accessToken: orderAccessToken(result.order.id),
      summary: result.summary,
      reservationExpiresAt: result.reservationExpiresAt.toISOString(),
    };
  } catch (e) {
    if (e instanceof Changed) return { ok: false, kind: "changed", message: "El total cambió desde que lo revisaste (precio, promoción, envío o cupón). Revisá el nuevo resumen y confirmá.", summary: e.summary };
    if (e instanceof Refuse) return { ok: false, kind: "error", message: e.message, pendingOrderId: e.pendingOrderId };
    if (e instanceof Existing) {
      const [again] = await db.select().from(orders).where(eq(orders.id, e.orderId));
      return { ok: true, orderId: again.id, orderNumber: orderNumber(again.number), accessToken: orderAccessToken(again.id), summary: await summaryFromOrder(again.id), reservationExpiresAt: (again.reservationExpiresAt ?? new Date()).toISOString() };
    }
    // Carrera con la misma checkoutKey (doble clic simultáneo): devolver el pedido ganador.
    if (String((e as { cause?: { code?: string } }).cause?.code ?? (e as { code?: string }).code) === "23505") {
      const [again] = await db.select().from(orders).where(eq(orders.checkoutKey, input.checkoutKey));
      if (again) return { ok: true, orderId: again.id, orderNumber: orderNumber(again.number), accessToken: orderAccessToken(again.id), summary: await summaryFromOrder(again.id), reservationExpiresAt: (again.reservationExpiresAt ?? new Date()).toISOString() };
    }
    throw e;
  }
}

/** Presupuesto previo (sin crear pedido) para mostrar el total con envío antes de confirmar. */
export async function quoteCheckout(cartId: string, shippingMethodId: string | null, postalCode: string, email: string | null) {
  const raw = await loadRawLines(cartId);
  const [cart] = await db.select().from(carts).where(eq(carts.id, cartId));
  let ship: ShippingSnapshot | null = null;
  if (shippingMethodId) {
    const { methods } = await availableShippingMethods(postalCode);
    const m = methods.find((x) => x.id === shippingMethodId);
    if (m) ship = { methodId: m.id, name: m.name, kind: m.kind, priceCents: m.priceCents, deliveryDaysMin: m.deliveryDaysMin, deliveryDaysMax: m.deliveryDaysMax, description: m.description };
  }
  const priced = await priceLines({ lines: raw, couponCode: cart?.couponCode, customerKey: email?.toLowerCase() ?? null, shippingCents: ship?.priceCents ?? 0 });
  return { summary: buildSummary(priced.lines, priced.totals, ship), hasIssues: priced.hasIssues, issues: priced.lines.filter((l) => l.issue).map((l) => `${l.productName}: ${l.issue!.message}`), shippingSelected: !!ship };
}

export async function summaryFromOrder(orderId: string): Promise<CheckoutSummary> {
  const [o] = await db.select().from(orders).where(eq(orders.id, orderId));
  const lines = await db.select().from(orderLines).where(eq(orderLines.orderId, orderId));
  return {
    lines: lines.map((l) => ({
      id: l.id,
      name: l.productName,
      variant: l.variantName,
      quantity: l.quantity,
      packUnits: l.packUnits,
      unitLabel: l.unitLabel,
      personalization: l.personalization.map((p) => ({ label: p.label, display: p.display })),
      lineTotalCents: l.lineTotalCents,
      lineRegularCents: (l.regularUnitPriceCents + l.surchargeUnitCents) * l.quantity,
    })),
    subtotalCents: o.subtotalCents,
    promotionDiscountCents: o.promotionDiscountCents,
    couponDiscountCents: o.couponDiscountCents,
    couponCode: o.couponCode,
    couponMessage: null,
    shippingCents: o.shippingCents,
    shippingName: o.shipping.name,
    totalCents: o.totalCents,
    productionDaysMax: o.productionDaysMax,
    deliveryDaysMin: o.shipping.deliveryDaysMin,
    deliveryDaysMax: o.shipping.deliveryDaysMax,
  };
}

