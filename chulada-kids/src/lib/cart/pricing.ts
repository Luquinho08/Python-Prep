import "server-only";
import { and, eq, gt, inArray, or, sql } from "drizzle-orm";
import { db, type DbOrTx } from "../db";
import {
  couponRedemptions,
  coupons,
  media,
  personalizationFields,
  productCategories,
  productImages,
  products,
  productVariants,
  type PersonalizationValue,
} from "../db/schema";
import { availableByVariant } from "../inventory/availability";
import { computeTotals, type CouponRule, type PricedLine, type Totals } from "../pricing/engine";
import { loadPromotionRules } from "../catalog/queries";
import { validatePersonalization, type FieldDef } from "../catalog/personalization";
import { publicMediaUrl } from "../storage";

export type RawLine = {
  id: string;
  productId: string;
  variantId: string;
  quantity: number;
  personalization: PersonalizationValue[];
};

export type LineIssue = { kind: "unavailable" | "insufficient" | "personalization" | "quantity"; message: string; maxQuantity?: number };

export type CartLineView = PricedLine & {
  id: string;
  variantId: string;
  productSlug: string;
  productName: string;
  variantName: string;
  sku: string;
  packUnits: number;
  unitLabel: string;
  image: { url: string; alt: string } | null;
  personalization: PersonalizationValue[];
  available: number;
  inventoryMode: "stock" | "capacity";
  requiresDesignApproval: boolean;
  productionDaysMax: number;
  minQty: number;
  qtyStep: number;
  maxQty: number | null;
  issue: LineIssue | null;
};

export async function loadCoupon(code: string | null | undefined, tx: DbOrTx = db): Promise<CouponRule | null> {
  if (!code) return null;
  const [c] = await tx.select().from(coupons).where(eq(coupons.code, code.trim().toUpperCase()));
  return c ?? null;
}

export async function couponUsage(couponId: string, customerKey: string | null, excludeOrderId: string | null, tx: DbOrTx = db) {
  const live = or(eq(couponRedemptions.status, "used"), and(eq(couponRedemptions.status, "reserved"), gt(couponRedemptions.reservedUntil, new Date())));
  const exclude = excludeOrderId ? sql`${couponRedemptions.orderId} <> ${excludeOrderId}` : sql`true`;
  const [total] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(couponRedemptions)
    .where(and(eq(couponRedemptions.couponId, couponId), live, exclude));
  let byCustomer = 0;
  if (customerKey) {
    const [c] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(couponRedemptions)
      .where(and(eq(couponRedemptions.couponId, couponId), eq(couponRedemptions.customerKey, customerKey), live, exclude));
    byCustomer = Number(c.n);
  }
  return { totalActive: Number(total.n), byCustomer };
}

/**
 * Recalcula todo desde la base: precios, promociones vigentes, recargos de personalización
 * (revalidados contra la definición actual), disponibilidad y cupón.
 */
export async function priceLines(opts: {
  lines: RawLine[];
  couponCode?: string | null;
  customerKey?: string | null;
  shippingCents?: number;
  now?: Date;
  tx?: DbOrTx;
  excludeOrderId?: string | null;
}): Promise<{ lines: CartLineView[]; totals: Totals; hasIssues: boolean }> {
  const tx = opts.tx ?? db;
  const now = opts.now ?? new Date();
  const productIds = [...new Set(opts.lines.map((l) => l.productId))];
  const variantIds = [...new Set(opts.lines.map((l) => l.variantId))];

  const [prods, variants, cats, fields, images, promos, avail] = await Promise.all([
    productIds.length ? tx.select().from(products).where(inArray(products.id, productIds)) : [],
    variantIds.length ? tx.select().from(productVariants).where(inArray(productVariants.id, variantIds)) : [],
    productIds.length ? tx.select().from(productCategories).where(inArray(productCategories.productId, productIds)) : [],
    productIds.length ? tx.select().from(personalizationFields).where(inArray(personalizationFields.productId, productIds)) : [],
    productIds.length
      ? tx
          .select({ productId: productImages.productId, key: media.storageKey, alt: productImages.alt, sort: productImages.sort })
          .from(productImages)
          .innerJoin(media, eq(media.id, productImages.mediaId))
          .where(inArray(productImages.productId, productIds))
      : [],
    loadPromotionRules(now, tx),
    availableByVariant(variantIds, tx),
  ]);

  // Cantidad total pedida por variante (varias líneas pueden compartir variante con personalizaciones distintas).
  const requestedByVariant = new Map<string, number>();
  for (const l of opts.lines) requestedByVariant.set(l.variantId, (requestedByVariant.get(l.variantId) ?? 0) + l.quantity);

  const meta = new Map<string, Omit<CartLineView, keyof PricedLine>>();
  const inputs = [];
  for (const l of opts.lines) {
    const p = prods.find((x) => x.id === l.productId);
    const v = variants.find((x) => x.id === l.variantId);
    let issue: LineIssue | null = null;
    if (!p || !v || p.status !== "published" || !v.isActive || v.productId !== p.id || p.isQuoteOnly) {
      issue = { kind: "unavailable", message: "Este producto ya no está disponible. Quitalo para continuar." };
    }
    const pf: FieldDef[] = fields
      .filter((f) => f.productId === l.productId)
      .map((f) => ({ ...f, options: f.options ?? [] }));
    const submitted = Object.fromEntries(l.personalization.map((x) => [x.key, x.value]));
    const pv = validatePersonalization(pf, submitted, { now });
    let surcharge = 0;
    if (pv.ok) surcharge = pv.surchargeUnitCents;
    else if (!issue) issue = { kind: "personalization", message: "La personalización cambió o está incompleta. Editala antes de continuar." };

    const available = avail.get(l.variantId) ?? 0;
    const requested = requestedByVariant.get(l.variantId) ?? l.quantity;
    if (!issue && p && !p.allowBackorder && requested > available) {
      issue = {
        kind: "insufficient",
        message: available > 0 ? `Solo quedan ${available} disponibles.` : "Sin disponibilidad en este momento.",
        maxQuantity: available,
      };
    }
    if (!issue && p) {
      const bad = l.quantity < p.minQty || (l.quantity - p.minQty) % p.qtyStep !== 0 || (p.maxQty != null && l.quantity > p.maxQty);
      if (bad) issue = { kind: "quantity", message: quantityRuleText(p.minQty, p.qtyStep, p.maxQty) };
    }
    const img = images.filter((i) => i.productId === l.productId).sort((a, b) => a.sort - b.sort)[0];
    meta.set(l.id, {
      id: l.id,
      variantId: l.variantId,
      productSlug: p?.slug ?? "",
      productName: p?.name ?? "Producto no disponible",
      variantName: v?.name ?? "",
      sku: v?.sku ?? "",
      packUnits: p?.packUnits ?? 1,
      unitLabel: p?.unitLabel ?? "unidad",
      image: img ? { url: publicMediaUrl(img.key) ?? "", alt: img.alt || p?.name || "" } : null,
      personalization: pv.ok ? pv.values.map((pvv) => ({ ...pvv })) : l.personalization,
      available,
      inventoryMode: p?.inventoryMode ?? "stock",
      requiresDesignApproval: p?.requiresDesignApproval ?? false,
      productionDaysMax: p?.productionDaysMax ?? 0,
      minQty: p?.minQty ?? 1,
      qtyStep: p?.qtyStep ?? 1,
      maxQty: p?.maxQty ?? null,
      issue,
    });
    inputs.push({
      key: l.id,
      productId: l.productId,
      categoryIds: cats.filter((c) => c.productId === l.productId).map((c) => c.categoryId),
      regularUnitCents: v?.priceCents ?? p?.basePriceCents ?? 0,
      surchargeUnitCents: surcharge,
      quantity: l.quantity,
    });
  }

  // Conservar el display de archivos (nombre) del valor original.
  for (const l of opts.lines) {
    const m = meta.get(l.id)!;
    m.personalization = m.personalization.map((pv) => {
      const orig = l.personalization.find((o) => o.key === pv.key);
      return orig?.mediaId ? { ...pv, display: orig.display } : pv;
    });
  }

  const coupon = await loadCoupon(opts.couponCode, tx);
  const usage = coupon ? await couponUsage(coupon.id, opts.customerKey ?? null, opts.excludeOrderId ?? null, tx) : undefined;
  const totals = computeTotals({ lines: inputs, promotions: promos, coupon, couponUsage: usage, shippingCents: opts.shippingCents, now });
  const lines: CartLineView[] = totals.lines.map((pl) => ({ ...pl, ...meta.get(pl.key)! }));
  return { lines, totals, hasIssues: lines.some((l) => l.issue) };
}

export function quantityRuleText(minQty: number, step: number, maxQty: number | null): string {
  const parts = [`mínimo ${minQty}`];
  if (step > 1) parts.push(`de a ${step}`);
  if (maxQty) parts.push(`máximo ${maxQty}`);
  return `Cantidad inválida: ${parts.join(", ")}.`;
}
