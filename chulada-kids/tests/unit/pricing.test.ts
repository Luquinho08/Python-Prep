import { describe, expect, it } from "vitest";
import { allocateProportionally, bestPromotion, computeTotals, evaluateCoupon, type CouponRule, type PromotionRule } from "@/lib/pricing/engine";

const now = new Date("2026-10-10T15:00:00Z");
const promo = (p: Partial<PromotionRule>): PromotionRule => ({
  id: p.id ?? "p1",
  name: p.name ?? "Promo",
  kind: p.kind ?? "percent",
  value: p.value ?? 1000,
  scope: p.scope ?? "products",
  productIds: p.productIds ?? ["A"],
  categoryIds: p.categoryIds ?? [],
  startsAt: p.startsAt ?? new Date("2026-10-01T00:00:00Z"),
  endsAt: p.endsAt === undefined ? null : p.endsAt,
  isActive: p.isActive ?? true,
  stackable: p.stackable ?? false,
  priority: p.priority ?? 0,
});
const coupon = (c: Partial<CouponRule>): CouponRule => ({
  id: "c1",
  code: "TEST",
  kind: "percent",
  value: 1000,
  minSubtotalCents: 0,
  startsAt: null,
  endsAt: null,
  maxUses: null,
  maxUsesPerCustomer: null,
  combinableWithPromotions: false,
  isActive: true,
  ...c,
});

describe("promociones", () => {
  it("elige la de mayor ahorro entre no acumulables (determinista)", () => {
    const r = bestPromotion([promo({ id: "a", value: 1000 }), promo({ id: "b", value: 2000 })], "A", [], 10000, now);
    expect(r.unitDiscountCents).toBe(2000);
    expect(r.applied.map((x) => x.id)).toEqual(["b"]);
  });

  it("combina acumulables sobre el remanente solo si ahorran más que la mejor individual", () => {
    const r = bestPromotion(
      [promo({ id: "a", value: 1000, stackable: true, priority: 2 }), promo({ id: "b", value: 1000, stackable: true, priority: 1 }), promo({ id: "c", value: 1500 })],
      "A",
      [],
      10000,
      now,
    );
    // 10% + 10% sobre remanente = 1900 > 1500 individual
    expect(r.unitDiscountCents).toBe(1900);
    expect(r.applied.map((x) => x.id)).toEqual(["a", "b"]);
  });

  it("un monto fijo nunca deja precio negativo", () => {
    const r = bestPromotion([promo({ kind: "fixed", value: 999999 })], "A", [], 5000, now);
    expect(r.unitDiscountCents).toBe(5000);
  });

  it("respeta vigencia: futura y vencida no aplican; límite de fin exclusivo", () => {
    const future = promo({ startsAt: new Date("2026-10-11T00:00:00Z") });
    const expired = promo({ endsAt: new Date("2026-10-05T00:00:00Z") });
    const endsNow = promo({ endsAt: now });
    expect(bestPromotion([future, expired, endsNow], "A", [], 10000, now).unitDiscountCents).toBe(0);
  });

  it("alcance por categoría", () => {
    const r = bestPromotion([promo({ scope: "categories", productIds: [], categoryIds: ["cat1"] })], "X", ["cat1"], 10000, now);
    expect(r.unitDiscountCents).toBe(1000);
  });
});

describe("cupones", () => {
  const lines = [
    { key: "l1", lineRegularCents: 10000, promotionDiscountCents: 0 },
    { key: "l2", lineRegularCents: 10000, promotionDiscountCents: 2000 },
  ];
  it("no combinable: solo sobre líneas sin promoción", () => {
    const ev = evaluateCoupon(coupon({}), lines, now, { totalActive: 0, byCustomer: 0 });
    expect(ev.ok && ev.discountCents).toBe(1000);
    expect(ev.ok && ev.allocation).toEqual({ l1: 1000 });
  });
  it("combinable: sobre todo el subtotal promocionado", () => {
    const ev = evaluateCoupon(coupon({ combinableWithPromotions: true }), lines, now, { totalActive: 0, byCustomer: 0 });
    expect(ev.ok && ev.discountCents).toBe(1800);
  });
  it("mínimo de compra, límites y vencimiento con errores claros", () => {
    expect(evaluateCoupon(coupon({ minSubtotalCents: 100000 }), lines, now, { totalActive: 0, byCustomer: 0 })).toMatchObject({ ok: false, error: expect.stringContaining("mínima") });
    expect(evaluateCoupon(coupon({ maxUses: 1 }), lines, now, { totalActive: 1, byCustomer: 0 })).toMatchObject({ ok: false, error: expect.stringContaining("límite") });
    expect(evaluateCoupon(coupon({ maxUsesPerCustomer: 1 }), lines, now, { totalActive: 0, byCustomer: 1 })).toMatchObject({ ok: false });
    expect(evaluateCoupon(coupon({ endsAt: new Date("2026-10-01T00:00:00Z") }), lines, now, { totalActive: 0, byCustomer: 0 })).toMatchObject({ ok: false, error: expect.stringContaining("vencido") });
  });
  it("monto fijo mayor al subtotal no genera total negativo", () => {
    const t = computeTotals({
      lines: [{ key: "a", productId: "A", categoryIds: [], regularUnitCents: 1000, surchargeUnitCents: 0, quantity: 1 }],
      promotions: [],
      coupon: coupon({ kind: "fixed", value: 500000, combinableWithPromotions: true }),
      shippingCents: 300,
      now,
    });
    expect(t.couponDiscountCents).toBe(1000);
    expect(t.totalCents).toBe(300);
  });
});

describe("totales", () => {
  it("los recargos de personalización no se promocionan y el total cuadra", () => {
    const t = computeTotals({
      lines: [{ key: "a", productId: "A", categoryIds: [], regularUnitCents: 10000, surchargeUnitCents: 500, quantity: 2 }],
      promotions: [promo({ value: 1000 })],
      shippingCents: 450,
      now,
    });
    expect(t.subtotalCents).toBe(21000);
    expect(t.promotionDiscountCents).toBe(2000);
    expect(t.totalCents).toBe(21000 - 2000 + 450);
    expect(t.lines[0].lineTotalCents).toBe(19000);
  });

  it("el reparto proporcional suma exactamente el total", () => {
    const a = allocateProportionally(1001, [
      { key: "x", weight: 3333 },
      { key: "y", weight: 3333 },
      { key: "z", weight: 3334 },
    ]);
    expect(Object.values(a).reduce((s, v) => s + v, 0)).toBe(1001);
  });
});
