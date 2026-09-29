import { beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import * as s from "@/lib/db/schema";
import { createOrderFromCart } from "@/lib/orders/checkout";
import { checkoutInput, makeCart, resetDb, seedBasics } from "../helpers/fixtures";

describe("checkout (Postgres real)", () => {
  let base: Awaited<ReturnType<typeof seedBasics>>;
  beforeEach(async () => {
    await resetDb();
    base = await seedBasics({ stock: 1, price: 100000 });
  });

  it("dos compradores del último stock: solo uno obtiene la reserva", async () => {
    const line = { productId: base.product.id, variantId: base.product.variant.id, quantity: 1 };
    const [c1, c2] = [await makeCart([line]), await makeCart([line])];
    const results = await Promise.all([
      createOrderFromCart(checkoutInput(base.pickup.id, 100000), { cartId: c1.id, userId: null }),
      createOrderFromCart(checkoutInput(base.pickup.id, 100000, { email: "otra@example.com" }), { cartId: c2.id, userId: null }),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    const failed = results.find((r) => !r.ok);
    expect(failed && !failed.ok && failed.message).toMatch(/agotó|quedan/);
    const [{ n }] = await db.select({ n: sql<number>`sum(quantity)::int` }).from(s.stockReservations).where(eq(s.stockReservations.status, "active"));
    expect(Number(n)).toBe(1);
  });

  it("doble clic / reintento con la misma clave devuelve el mismo pedido", async () => {
    const cart = await makeCart([{ productId: base.product.id, variantId: base.product.variant.id, quantity: 1 }]);
    const input = checkoutInput(base.pickup.id, 100000);
    const [a, b] = await Promise.all([createOrderFromCart(input, { cartId: cart.id, userId: null }), createOrderFromCart(input, { cartId: cart.id, userId: null })]);
    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) expect(a.orderId).toBe(b.orderId);
    const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(s.orders);
    expect(Number(n)).toBe(1);
  });

  it("un total alterado en el navegador no se cobra: exige confirmar el total real", async () => {
    const cart = await makeCart([{ productId: base.product.id, variantId: base.product.variant.id, quantity: 1 }]);
    const r = await createOrderFromCart(checkoutInput(base.pickup.id, 1), { cartId: cart.id, userId: null });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.kind).toBe("changed");
    if (!r.ok && r.kind === "changed") expect(r.summary.totalCents).toBe(100000);
    const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(s.orders);
    expect(Number(n)).toBe(0);
  });

  it("envío: costo conocido antes de pagar, sin cobertura no hay pedido, dirección obligatoria", async () => {
    const cart = await makeCart([{ productId: base.product.id, variantId: base.product.variant.id, quantity: 1 }]);
    const noCoverage = await createOrderFromCart(checkoutInput(base.delivery.id, 150000, { postalCode: "5000", street: "A", number: "1", city: "C", province: "P" }), { cartId: cart.id, userId: null });
    expect(!noCoverage.ok && noCoverage.message).toContain("no llega");
    const noAddress = await createOrderFromCart(checkoutInput(base.delivery.id, 150000), { cartId: cart.id, userId: null });
    expect(!noAddress.ok && noAddress.kind === "error" && noAddress.fieldErrors?.street).toBeTruthy();
    const ok = await createOrderFromCart(checkoutInput(base.delivery.id, 150000, { street: "Calle", number: "1", city: "CABA", province: "BA" }), { cartId: cart.id, userId: null });
    expect(ok.ok && ok.summary.shippingCents).toBe(50000);
  });

  it("cupón con un solo uso: dos pedidos simultáneos no lo usan dos veces", async () => {
    await base.product && db.update(s.productVariants).set({ stockOnHand: 10 }).where(eq(s.productVariants.id, base.product.variant.id));
    await db.insert(s.coupons).values({ code: "UNO", kind: "fixed", value: 10000, maxUses: 1, combinableWithPromotions: true });
    const line = { productId: base.product.id, variantId: base.product.variant.id, quantity: 1 };
    const c1 = await makeCart([line], "UNO");
    const c2 = await makeCart([line], "UNO");
    const res = await Promise.all([
      createOrderFromCart(checkoutInput(base.pickup.id, 90000, { email: "a@x.com" }), { cartId: c1.id, userId: null }),
      createOrderFromCart(checkoutInput(base.pickup.id, 90000, { email: "b@x.com" }), { cartId: c2.id, userId: null }),
    ]);
    expect(res.filter((r) => r.ok)).toHaveLength(1);
    const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(s.couponRedemptions).where(eq(s.couponRedemptions.status, "reserved"));
    expect(Number(n)).toBe(1);
  });

  it("editar datos reemplaza el pedido anterior y libera su reserva (sin duplicar stock retenido)", async () => {
    const cart = await makeCart([{ productId: base.product.id, variantId: base.product.variant.id, quantity: 1 }]);
    const first = await createOrderFromCart(checkoutInput(base.pickup.id, 100000), { cartId: cart.id, userId: null });
    const second = await createOrderFromCart(checkoutInput(base.pickup.id, 100000, { name: "Ana Editada" }), { cartId: cart.id, userId: null });
    expect(first.ok && second.ok).toBe(true);
    const [old] = await db.select().from(s.orders).where(eq(s.orders.id, first.ok ? first.orderId : ""));
    expect(old.supersededBy).toBe(second.ok ? second.orderId : "x");
    const active = await db.select().from(s.stockReservations).where(eq(s.stockReservations.status, "active"));
    expect(active).toHaveLength(1);
  });

  it("guarda snapshot: editar el catálogo no altera el pedido", async () => {
    const cart = await makeCart([{ productId: base.product.id, variantId: base.product.variant.id, quantity: 1 }]);
    const r = await createOrderFromCart(checkoutInput(base.pickup.id, 100000), { cartId: cart.id, userId: null });
    await db.update(s.products).set({ name: "Nombre nuevo", basePriceCents: 999999 }).where(eq(s.products.id, base.product.id));
    const [line] = await db.select().from(s.orderLines).where(eq(s.orderLines.orderId, r.ok ? r.orderId : ""));
    expect(line.productName).toBe("Producto caja");
    expect(line.unitPriceCents).toBe(100000);
  });
});
