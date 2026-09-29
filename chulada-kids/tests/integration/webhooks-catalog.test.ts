import { createHmac, randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import * as s from "@/lib/db/schema";
import { POST as webhook } from "@/app/api/webhooks/mercadopago/route";
import { processWebhookEvent } from "@/lib/payments/webhooks";
import { createOrderFromCart } from "@/lib/orders/checkout";
import { startCardPayment } from "@/lib/payments/service";
import { authorizeOrderAccess, orderAccessToken } from "@/lib/orders/access";
import { getComplements, searchCatalog, loadPromotionRules } from "@/lib/catalog/queries";
import { storeLocalToUtc } from "@/lib/time";
import { checkoutInput, makeCart, makeProduct, resetDb, seedBasics } from "../helpers/fixtures";

function signedRequest(type: string, dataId: string, opts: { secret?: string; requestId?: string } = {}) {
  const requestId = opts.requestId ?? randomUUID();
  const ts = Math.floor(Date.now() / 1000).toString();
  const v1 = createHmac("sha256", opts.secret ?? "test-webhook-secret").update(`id:${dataId};request-id:${requestId};ts:${ts};`).digest("hex");
  return new Request(`http://tienda.test/api/webhooks/mercadopago?data.id=${dataId}&type=${type}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-signature": `ts=${ts},v1=${v1}`, "x-request-id": requestId },
    body: JSON.stringify({ type, data: { id: dataId } }),
  });
}

describe("webhooks de Mercado Pago", () => {
  let base: Awaited<ReturnType<typeof seedBasics>>;
  let orderId: string;
  let providerRef: string;
  beforeEach(async () => {
    await resetDb();
    base = await seedBasics({ stock: 5, price: 100000 });
    const cart = await makeCart([{ productId: base.product.id, variantId: base.product.variant.id, quantity: 1 }]);
    const o = await createOrderFromCart(checkoutInput(base.pickup.id, 100000), { cartId: cart.id, userId: null });
    if (!o.ok) throw new Error("setup");
    orderId = o.orderId;
    await startCardPayment(orderId, { idempotencyKey: randomUUID(), token: "fake:pending", paymentMethodId: "visa", paymentTypeId: "credit_card", installments: 1, transactionAmount: 1000, payerEmail: "a@x.com" });
    const [a] = await db.select().from(s.paymentAttempts).where(eq(s.paymentAttempts.orderId, orderId));
    providerRef = a.providerRef!;
  });

  it("firma inválida: 401, se registra y no se procesa", async () => {
    const res = await webhook(signedRequest("order", providerRef, { secret: "otro-secreto" }));
    expect(res.status).toBe(401);
    const [ev] = await db.select().from(s.webhookEvents);
    expect(ev.status).toBe("rejected");
    expect(ev.signatureValid).toBe(false);
  });

  it("firma válida: consulta el recurso oficial y actualiza; duplicado y fuera de orden no alteran nada", async () => {
    // El proveedor aprueba (el cuerpo del webhook NO se usa como verdad).
    const { FakeGateway } = await import("@/lib/payments/fake");
    const raw = await db.select().from(s.fakeProviderObjects).where(eq(s.fakeProviderObjects.id, providerRef));
    const data = raw[0].data as { status: string; status_detail: string; transactions: { payments: { status: string; status_detail: string }[] } };
    data.status = "processed";
    data.status_detail = "accredited";
    data.transactions.payments[0].status = "processed";
    data.transactions.payments[0].status_detail = "accredited";
    await db.update(s.fakeProviderObjects).set({ data }).where(eq(s.fakeProviderObjects.id, providerRef));
    void FakeGateway;

    const requestId = randomUUID();
    const res = await webhook(signedRequest("order", providerRef, { requestId }));
    expect(res.status).toBe(200);
    const [ev] = await db.select().from(s.webhookEvents);
    await processWebhookEvent(ev.id); // (el handler también lo agenda en segundo plano)
    const [o] = await db.select().from(s.orders).where(eq(s.orders.id, orderId));
    expect(o.paymentStatus).toBe("approved");
    const stock = (await db.select().from(s.productVariants).where(eq(s.productVariants.id, base.product.variant.id)))[0].stockOnHand;

    // Mismo evento repetido → deduplicado.
    expect((await webhook(signedRequest("order", providerRef, { requestId }))).status).toBe(200);
    expect(await db.select().from(s.webhookEvents)).toHaveLength(1);

    // Evento "viejo" que llega después (otro request-id): se consulta el estado actual; no hay regresión ni doble descuento.
    const res2 = await webhook(signedRequest("order", providerRef));
    expect(res2.status).toBe(200);
    for (const e of await db.select().from(s.webhookEvents)) await processWebhookEvent(e.id);
    const [o2] = await db.select().from(s.orders).where(eq(s.orders.id, orderId));
    expect(o2.paymentStatus).toBe("approved");
    expect((await db.select().from(s.productVariants).where(eq(s.productVariants.id, base.product.variant.id)))[0].stockOnHand).toBe(stock);
  });

  it("acceso a pedidos: token correcto sí, id sin token o token ajeno no", async () => {
    expect(await authorizeOrderAccess(orderId, orderAccessToken(orderId))).not.toBeNull();
    expect(await authorizeOrderAccess(orderId, null)).toBeNull();
    expect(await authorizeOrderAccess(orderId, orderAccessToken(randomUUID()))).toBeNull();
  });
});

describe("catálogo y complementarios", () => {
  let base: Awaited<ReturnType<typeof seedBasics>>;
  beforeEach(async () => {
    await resetDb();
    base = await seedBasics({ stock: 5 });
    await db.insert(s.categoryComplements).values({ categoryId: base.cat.id, complementCategoryId: base.cat2.id });
  });

  it("borradores no aparecen en búsqueda ni como complementarios", async () => {
    const draft = await makeProduct({ slug: "borrador", sku: "BOR", price: 100, stock: 5, categoryId: base.cat2.id, themeId: base.theme.id, status: "draft" });
    await db.insert(s.productRelations).values({ productId: base.product.id, relatedProductId: draft.id });
    expect((await searchCatalog({ q: "borrador" })).total).toBe(0);
    expect((await getComplements(base.product.id)).map((c) => c.id)).not.toContain(draft.id);
  });

  it("automáticos: requieren categoría compatible Y temática/etiqueta compartida; excluye agotados y a presupuesto", async () => {
    const ok = await makeProduct({ slug: "etiq-dino", sku: "E1", price: 100, stock: 5, categoryId: base.cat2.id, themeId: base.theme.id });
    const noShared = await makeProduct({ slug: "etiq-otra", sku: "E2", price: 100, stock: 5, categoryId: base.cat2.id });
    const out = await makeProduct({ slug: "etiq-agotada", sku: "E3", price: 100, stock: 0, categoryId: base.cat2.id, themeId: base.theme.id });
    const quote = await makeProduct({ slug: "etiq-presu", sku: "E4", price: 0, stock: 0, categoryId: base.cat2.id, themeId: base.theme.id, quote: true });
    const sameCat = await makeProduct({ slug: "otra-caja", sku: "C2", price: 100, stock: 5, categoryId: base.cat.id, themeId: base.theme.id });
    const ids = (await getComplements(base.product.id)).map((c) => c.id);
    expect(ids).toContain(ok.id);
    for (const bad of [noShared.id, out.id, quote.id, sameCat.id, base.product.id]) expect(ids).not.toContain(bad);
  });

  it("manuales primero y en su orden; sin complementos válidos la lista queda vacía", async () => {
    expect(await getComplements(base.product.id)).toHaveLength(0);
    const a = await makeProduct({ slug: "a", sku: "A", price: 100, stock: 5, categoryId: base.cat.id });
    const b = await makeProduct({ slug: "b", sku: "B", price: 100, stock: 5, categoryId: base.cat.id });
    await db.insert(s.productRelations).values([{ productId: base.product.id, relatedProductId: b.id, sort: 1 }, { productId: base.product.id, relatedProductId: a.id, sort: 2 }]);
    expect((await getComplements(base.product.id)).map((c) => c.slug)).toEqual(["b", "a"]);
  });

  it("promociones empiezan y vencen según la hora de Buenos Aires", async () => {
    await db.insert(s.promotions).values({ name: "Octubre", kind: "percent", value: 1000, scope: "all", startsAt: storeLocalToUtc("2026-10-01T00:00"), endsAt: storeLocalToUtc("2026-10-02T00:00") });
    expect(await loadPromotionRules(new Date("2026-10-01T02:59:00Z"))).toHaveLength(0); // 30/09 23:59 en AR
    expect(await loadPromotionRules(new Date("2026-10-01T03:00:00Z"))).toHaveLength(1); // 01/10 00:00 en AR
    expect(await loadPromotionRules(new Date("2026-10-02T03:00:00Z"))).toHaveLength(0); // vencida
  });
});
