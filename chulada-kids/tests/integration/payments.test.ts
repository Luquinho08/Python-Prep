import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import * as s from "@/lib/db/schema";
import { createOrderFromCart } from "@/lib/orders/checkout";
import { applyProviderState, reconcileAttempt, refundOrderPayment, startCardPayment, startWalletPayment, PaymentFlowError } from "@/lib/payments/service";
import { FakeGateway } from "@/lib/payments/fake";
import { expireReservations } from "@/lib/jobs";
import { checkoutInput, makeCart, resetDb, seedBasics } from "../helpers/fixtures";

type Base = Awaited<ReturnType<typeof seedBasics>>;

async function placeOrder(base: Base, qty = 1, email = "ana@example.com") {
  const cart = await makeCart([{ productId: base.product.id, variantId: base.product.variant.id, quantity: qty }]);
  const r = await createOrderFromCart(checkoutInput(base.pickup.id, base.product.basePriceCents * qty, { email }), { cartId: cart.id, userId: null });
  if (!r.ok) throw new Error(r.message);
  return r;
}

const card = (orderId: string, total: number, scenario: string, key = randomUUID()) =>
  startCardPayment(orderId, {
    idempotencyKey: key,
    token: `fake:${scenario}`,
    paymentMethodId: "visa",
    paymentTypeId: "credit_card",
    installments: 1,
    transactionAmount: total / 100,
    payerEmail: "ana@example.com",
  });

const stockOf = async (variantId: string) => (await db.select().from(s.productVariants).where(eq(s.productVariants.id, variantId)))[0].stockOnHand;
const orderOf = async (id: string) => (await db.select().from(s.orders).where(eq(s.orders.id, id)))[0];

describe("pagos con el simulador (misma interfaz que el adaptador real)", () => {
  let base: Base;
  beforeEach(async () => {
    await resetDb();
    base = await seedBasics({ stock: 3, price: 100000 });
  });

  it("aprobado: el pedido se aprueba una sola vez, descuenta stock y encola emails deduplicados", async () => {
    const o = await placeOrder(base);
    const out = await card(o.orderId, 100000, "approve");
    expect(out.status).toBe("approved");
    expect((await orderOf(o.orderId)).paymentStatus).toBe("approved");
    expect(await stockOf(base.product.variant.id)).toBe(2);

    // Webhook repetido / conciliación: no vuelve a descontar ni a encolar emails.
    const [attempt] = await db.select().from(s.paymentAttempts).where(eq(s.paymentAttempts.orderId, o.orderId));
    await reconcileAttempt(attempt.id);
    await reconcileAttempt(attempt.id);
    expect(await stockOf(base.product.variant.id)).toBe(2);
    const mails = await db.select().from(s.emailOutbox).where(sql`${s.emailOutbox.dedupeKey} LIKE ${`order-paid%${o.orderId}`}`);
    expect(mails).toHaveLength(2); // cliente + propietario, una vez cada uno
  });

  it("la misma clave de idempotencia no crea un segundo intento ni un segundo cobro", async () => {
    const o = await placeOrder(base);
    const key = randomUUID();
    const [a, b] = await Promise.all([card(o.orderId, 100000, "approve", key), card(o.orderId, 100000, "approve", key)]);
    expect(a.attemptId).toBe(b.attemptId);
    const attempts = await db.select().from(s.paymentAttempts).where(eq(s.paymentAttempts.orderId, o.orderId));
    expect(attempts).toHaveLength(1);
  });

  it("el importe del formulario debe coincidir con el total del pedido", async () => {
    const o = await placeOrder(base);
    await expect(card(o.orderId, 1000, "approve")).rejects.toMatchObject({ code: "amount_changed" });
  });

  it("rechazo permite reintentar de forma controlada con una clave nueva", async () => {
    const o = await placeOrder(base);
    expect((await card(o.orderId, 100000, "reject")).status).toBe("rejected");
    expect((await orderOf(o.orderId)).paymentStatus).toBe("rejected");
    expect((await card(o.orderId, 100000, "approve")).status).toBe("approved");
  });

  it("timeout: queda 'por verificar' (no rechazado) y la conciliación lo resuelve", async () => {
    const o = await placeOrder(base);
    const out = await card(o.orderId, 100000, "timeout");
    // La conciliación inmediata encuentra la order por external_reference.
    expect(["to_verify", "approved"]).toContain(out.status);
    const [attempt] = await db.select().from(s.paymentAttempts).where(eq(s.paymentAttempts.orderId, o.orderId));
    await reconcileAttempt(attempt.id);
    expect((await orderOf(o.orderId)).paymentStatus).toBe("approved");
  });

  it("un pago pendiente bloquea iniciar otro medio (sin dos cobros silenciosos)", async () => {
    const o = await placeOrder(base);
    expect((await card(o.orderId, 100000, "pending")).status).toBe("pending");
    await expect(startWalletPayment(o.orderId, randomUUID())).rejects.toBeInstanceOf(PaymentFlowError);
    await expect(card(o.orderId, 100000, "approve")).rejects.toMatchObject({ code: "in_flight" });
    // El pendiente extiende la reserva en lugar de liberarla.
    const [res] = await db.select().from(s.stockReservations).where(eq(s.stockReservations.orderId, o.orderId));
    expect(res.expiresAt.getTime()).toBeGreaterThan(Date.now() + 60 * 60_000);
  });

  it("3DS: requiere acción y se completa luego con la verificación", async () => {
    const o = await placeOrder(base);
    const out = await card(o.orderId, 100000, "challenge");
    expect(out.status).toBe("requires_action");
    expect(out.challengeUrl).toContain("simulador-3ds");
    const [attempt] = await db.select().from(s.paymentAttempts).where(eq(s.paymentAttempts.orderId, o.orderId));
    await FakeGateway.completeChallenge(attempt.providerRef!, true);
    await reconcileAttempt(attempt.id);
    expect((await orderOf(o.orderId)).paymentStatus).toBe("approved");
  });

  it("Wallet: cambiar a tarjeta vence la preferencia; un pago tardío a esa preferencia abre incidencia de pago duplicado", async () => {
    const o = await placeOrder(base);
    const w = await startWalletPayment(o.orderId, randomUUID());
    expect(w.preferenceId).toContain("FAKEPREF");
    // Cambia de método: se verifica y se vence la preferencia sin pagos.
    expect((await card(o.orderId, 100000, "approve")).status).toBe("approved");
    await expect(FakeGateway.payPreference(w.preferenceId, "approved")).rejects.toThrow(/venció/);

    // Aun así, si el proveedor informara un segundo pago aprobado, no se duplica la entrega.
    await applyProviderState(w.attemptId, {
      kind: "payments", providerRef: w.preferenceId, status: "approved", statusDetail: null, externalReference: w.attemptId, amountCents: null, currency: "ARS", collectorId: "fake-collector-0001", challengeUrl: null,
      payments: [{ providerPaymentId: "EXTRA-1", status: "approved", statusDetail: "accredited", amountCents: 100000, refundedCents: 0, currency: "ARS", collectorId: "fake-collector-0001", externalReference: w.attemptId, installments: 1, paymentMethodId: "account_money", dateOfExpiration: null }],
    }, "webhook");
    const incs = await db.select().from(s.incidents).where(and(eq(s.incidents.orderId, o.orderId), eq(s.incidents.kind, "duplicate_payment")));
    expect(incs).toHaveLength(1);
    expect(await stockOf(base.product.variant.id)).toBe(2);
  });

  it("verificación: moneda, cuenta receptora o importe distintos no aprueban el pedido", async () => {
    const o = await placeOrder(base);
    const w = await startWalletPayment(o.orderId, randomUUID());
    await applyProviderState(w.attemptId, {
      kind: "payments", providerRef: w.preferenceId, status: "approved", statusDetail: null, externalReference: w.attemptId, amountCents: null, currency: "ARS", collectorId: "otra-cuenta", challengeUrl: null,
      payments: [{ providerPaymentId: "P-X", status: "approved", statusDetail: "accredited", amountCents: 100, refundedCents: 0, currency: "USD", collectorId: "otra-cuenta", externalReference: w.attemptId, installments: 1, paymentMethodId: "x", dateOfExpiration: null }],
    }, "webhook");
    expect((await orderOf(o.orderId)).paymentStatus).not.toBe("approved");
    const incs = await db.select().from(s.incidents).where(eq(s.incidents.kind, "amount_mismatch"));
    expect(incs).toHaveLength(1);
  });

  it("reembolso parcial y total quedan sincronizados con el proveedor", async () => {
    const o = await placeOrder(base);
    await card(o.orderId, 100000, "approve");
    const owner = (await db.insert(s.users).values({ email: "o@x.com", role: "owner" }).returning())[0];
    await refundOrderPayment(o.orderId, 30000, owner.id);
    expect((await orderOf(o.orderId)).paymentStatus).toBe("partially_refunded");
    await refundOrderPayment(o.orderId, null, owner.id);
    expect((await orderOf(o.orderId)).paymentStatus).toBe("refunded");
  });

  it("aprobación tardía sin stock: abre incidencia y nunca deja stock negativo", async () => {
    await db.update(s.productVariants).set({ stockOnHand: 1 }).where(eq(s.productVariants.id, base.product.variant.id));
    const o = await placeOrder(base);
    // La reserva vence y otra persona compra la última unidad.
    await db.update(s.stockReservations).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(s.stockReservations.orderId, o.orderId));
    const o2 = await placeOrder(base, 1, "otra@example.com");
    await card(o2.orderId, 100000, "approve");
    // Llega tarde la aprobación del primer pedido (p. ej. pago offline).
    const w = await db.insert(s.paymentAttempts).values({ orderId: o.orderId, method: "wallet", driver: "fake", environment: "test", idempotencyKey: randomUUID(), amountCents: 100000, status: "pending" }).returning();
    await applyProviderState(w[0].id, {
      kind: "payments", providerRef: null, status: "approved", statusDetail: null, externalReference: w[0].id, amountCents: null, currency: "ARS", collectorId: "fake-collector-0001", challengeUrl: null,
      payments: [{ providerPaymentId: "LATE-1", status: "approved", statusDetail: "accredited", amountCents: 100000, refundedCents: 0, currency: "ARS", collectorId: "fake-collector-0001", externalReference: w[0].id, installments: 1, paymentMethodId: "rapipago", dateOfExpiration: null }],
    }, "webhook");
    expect(await stockOf(base.product.variant.id)).toBe(0);
    const incs = await db.select().from(s.incidents).where(and(eq(s.incidents.orderId, o.orderId), eq(s.incidents.kind, "late_approval_no_stock")));
    expect(incs).toHaveLength(1);
  });

  it("vencimiento: libera stock y cupón si no hay pago en curso; no libera si hay un pago pendiente", async () => {
    const unpaid = await placeOrder(base);
    const pending = await placeOrder(base, 1, "b@example.com");
    await card(pending.orderId, 100000, "pending");
    await db.update(s.orders).set({ reservationExpiresAt: new Date(Date.now() - 1000) });
    await db.update(s.stockReservations).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(s.stockReservations.orderId, unpaid.orderId));
    await expireReservations();
    expect((await orderOf(unpaid.orderId)).paymentStatus).toBe("expired");
    expect((await orderOf(pending.orderId)).paymentStatus).toBe("pending");
    const [res] = await db.select().from(s.stockReservations).where(eq(s.stockReservations.orderId, pending.orderId));
    expect(res.status).toBe("active");
  });
});
