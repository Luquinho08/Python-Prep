/**
 * Motor de precios central. Funciones puras: el servidor es la única autoridad
 * y todos los importes son centavos enteros.
 */
import { clampNonNegative, formatARS, percentOf } from "../money";

export type DiscountKind = "percent" | "fixed";

export type PromotionRule = {
  id: string;
  name: string;
  kind: DiscountKind;
  /** percent: basis points (1000 = 10 %); fixed: centavos por pack/unidad vendida */
  value: number;
  scope: "products" | "categories" | "all";
  productIds: string[];
  categoryIds: string[];
  startsAt: Date;
  endsAt: Date | null;
  isActive: boolean;
  stackable: boolean;
  priority: number;
};

export type CouponRule = {
  id: string;
  code: string;
  kind: DiscountKind;
  value: number;
  minSubtotalCents: number;
  startsAt: Date | null;
  endsAt: Date | null;
  maxUses: number | null;
  maxUsesPerCustomer: number | null;
  combinableWithPromotions: boolean;
  isActive: boolean;
};

export type PricingLineInput = {
  key: string;
  productId: string;
  categoryIds: string[];
  /** Precio normal por pack/unidad vendida (variante o base). */
  regularUnitCents: number;
  /** Recargos de personalización por pack/unidad vendida (no se promocionan). */
  surchargeUnitCents: number;
  quantity: number;
};

export type AppliedPromotion = { id: string; name: string; savingCents: number };

export type PromotionResult = { unitDiscountCents: number; applied: AppliedPromotion[] };

export function isPromotionLive(p: PromotionRule, now: Date): boolean {
  return p.isActive && p.startsAt.getTime() <= now.getTime() && (p.endsAt === null || now.getTime() < p.endsAt.getTime());
}

export function promotionApplies(p: PromotionRule, productId: string, categoryIds: string[]): boolean {
  if (p.scope === "all") return true;
  if (p.scope === "products") return p.productIds.includes(productId);
  return p.categoryIds.some((c) => categoryIds.includes(c));
}

function discountOn(p: PromotionRule, priceCents: number): number {
  if (priceCents <= 0) return 0;
  const raw = p.kind === "percent" ? percentOf(priceCents, Math.min(p.value, 10000)) : p.value;
  return Math.max(0, Math.min(raw, priceCents));
}

const byPriority = (a: PromotionRule, b: PromotionRule) => b.priority - a.priority || a.id.localeCompare(b.id);

/**
 * Elige de forma determinista la mejor combinación permitida:
 * - la mejor promoción individual (mayor ahorro; empate → prioridad → id), o
 * - la combinación de todas las acumulables (aplicadas en orden de prioridad sobre el remanente),
 * la que ahorre más (empate → individual).
 */
export function bestPromotion(
  promos: PromotionRule[],
  productId: string,
  categoryIds: string[],
  regularUnitCents: number,
  now: Date,
): PromotionResult {
  const candidates = promos.filter((p) => isPromotionLive(p, now) && promotionApplies(p, productId, categoryIds)).sort(byPriority);
  if (candidates.length === 0 || regularUnitCents <= 0) return { unitDiscountCents: 0, applied: [] };

  let best: PromotionResult = { unitDiscountCents: 0, applied: [] };
  for (const p of candidates) {
    const saving = discountOn(p, regularUnitCents);
    if (saving > best.unitDiscountCents) best = { unitDiscountCents: saving, applied: [{ id: p.id, name: p.name, savingCents: saving }] };
  }

  const stackables = candidates.filter((p) => p.stackable);
  if (stackables.length > 1) {
    let remaining = regularUnitCents;
    const applied: AppliedPromotion[] = [];
    for (const p of stackables) {
      const saving = discountOn(p, remaining);
      if (saving > 0) {
        remaining -= saving;
        applied.push({ id: p.id, name: p.name, savingCents: saving });
      }
    }
    const total = regularUnitCents - remaining;
    if (total > best.unitDiscountCents) best = { unitDiscountCents: total, applied };
  }
  return best;
}

export type CouponUsage = { totalActive: number; byCustomer: number };

export type CouponEvaluation =
  | { ok: true; discountCents: number; allocation: Record<string, number>; message: string }
  | { ok: false; error: string };

export type PricedLine = PricingLineInput & {
  unitPromotionDiscountCents: number;
  appliedPromotions: AppliedPromotion[];
  /** (regular + recargo) × cantidad */
  lineRegularCents: number;
  promotionDiscountCents: number;
  couponDiscountCents: number;
  lineTotalCents: number;
};

export function evaluateCoupon(
  coupon: CouponRule,
  lines: Pick<PricedLine, "key" | "lineRegularCents" | "promotionDiscountCents">[],
  now: Date,
  usage: CouponUsage,
): CouponEvaluation {
  if (!coupon.isActive) return { ok: false, error: "Este cupón no está activo." };
  if (coupon.startsAt && now < coupon.startsAt) return { ok: false, error: "Este cupón todavía no está vigente." };
  if (coupon.endsAt && now >= coupon.endsAt) return { ok: false, error: "Este cupón está vencido." };
  if (coupon.maxUses !== null && usage.totalActive >= coupon.maxUses)
    return { ok: false, error: "Este cupón alcanzó su límite de usos." };
  if (coupon.maxUsesPerCustomer !== null && usage.byCustomer >= coupon.maxUsesPerCustomer)
    return { ok: false, error: "Ya usaste este cupón la cantidad de veces permitida." };

  const merchandise = lines.reduce((s, l) => s + l.lineRegularCents - l.promotionDiscountCents, 0);
  if (merchandise < coupon.minSubtotalCents)
    return { ok: false, error: `Este cupón requiere una compra mínima de ${formatARS(coupon.minSubtotalCents)} en productos.` };

  const eligible = lines.filter((l) => coupon.combinableWithPromotions || l.promotionDiscountCents === 0);
  const base = eligible.reduce((s, l) => s + l.lineRegularCents - l.promotionDiscountCents, 0);
  if (base <= 0)
    return { ok: false, error: "Este cupón no se combina con productos en promoción y no hay otros productos en el carrito." };

  const discount = Math.min(base, coupon.kind === "percent" ? percentOf(base, Math.min(coupon.value, 10000)) : coupon.value);
  const allocation = allocateProportionally(
    discount,
    eligible.map((l) => ({ key: l.key, weight: l.lineRegularCents - l.promotionDiscountCents })),
  );
  const partial = eligible.length < lines.length ? " Se aplica solo a productos sin promoción." : "";
  return { ok: true, discountCents: discount, allocation, message: `Cupón ${coupon.code} aplicado.${partial}` };
}

/** Reparte un importe entre líneas por peso (método del mayor resto). Nunca supera el peso de cada línea. */
export function allocateProportionally(amount: number, items: { key: string; weight: number }[]): Record<string, number> {
  const total = items.reduce((s, i) => s + i.weight, 0);
  const result: Record<string, number> = {};
  if (total <= 0 || amount <= 0) {
    for (const i of items) result[i.key] = 0;
    return result;
  }
  let assigned = 0;
  const remainders: { key: string; rem: number }[] = [];
  for (const i of items) {
    const exact = (amount * i.weight) / total;
    const floor = Math.floor(exact);
    result[i.key] = floor;
    assigned += floor;
    remainders.push({ key: i.key, rem: exact - floor });
  }
  remainders.sort((a, b) => b.rem - a.rem || a.key.localeCompare(b.key));
  for (let k = 0; assigned < amount && k < remainders.length; k++, assigned++) result[remainders[k].key] += 1;
  return result;
}

export type Totals = {
  lines: PricedLine[];
  subtotalCents: number;
  promotionDiscountCents: number;
  couponDiscountCents: number;
  shippingCents: number;
  totalCents: number;
  coupon: { code: string; ok: boolean; message: string } | null;
};

export function computeTotals(input: {
  lines: PricingLineInput[];
  promotions: PromotionRule[];
  coupon?: CouponRule | null;
  couponUsage?: CouponUsage;
  shippingCents?: number;
  now: Date;
}): Totals {
  const priced: PricedLine[] = input.lines.map((l) => {
    const promo = bestPromotion(input.promotions, l.productId, l.categoryIds, l.regularUnitCents, input.now);
    const lineRegularCents = (l.regularUnitCents + l.surchargeUnitCents) * l.quantity;
    const promotionDiscountCents = promo.unitDiscountCents * l.quantity;
    return {
      ...l,
      unitPromotionDiscountCents: promo.unitDiscountCents,
      appliedPromotions: promo.applied,
      lineRegularCents,
      promotionDiscountCents,
      couponDiscountCents: 0,
      lineTotalCents: lineRegularCents - promotionDiscountCents,
    };
  });

  let coupon: Totals["coupon"] = null;
  let couponDiscountCents = 0;
  if (input.coupon) {
    const ev = evaluateCoupon(input.coupon, priced, input.now, input.couponUsage ?? { totalActive: 0, byCustomer: 0 });
    if (ev.ok) {
      couponDiscountCents = ev.discountCents;
      for (const l of priced) {
        l.couponDiscountCents = ev.allocation[l.key] ?? 0;
        l.lineTotalCents = clampNonNegative(l.lineTotalCents - l.couponDiscountCents);
      }
      coupon = { code: input.coupon.code, ok: true, message: ev.message };
    } else {
      coupon = { code: input.coupon.code, ok: false, message: ev.error };
    }
  }

  const subtotalCents = priced.reduce((s, l) => s + l.lineRegularCents, 0);
  const promotionDiscountCents = priced.reduce((s, l) => s + l.promotionDiscountCents, 0);
  const shippingCents = Math.max(0, input.shippingCents ?? 0);
  const totalCents = clampNonNegative(subtotalCents - promotionDiscountCents - couponDiscountCents) + shippingCents;
  return { lines: priced, subtotalCents, promotionDiscountCents, couponDiscountCents, shippingCents, totalCents, coupon };
}
