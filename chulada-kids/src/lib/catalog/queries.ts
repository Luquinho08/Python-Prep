import "server-only";
import { and, asc, eq, inArray, isNull, lte, or, gt, sql } from "drizzle-orm";
import { cache } from "react";
import { db, type DbOrTx } from "../db";
import {
  categories,
  categoryComplements,
  media,
  personalizationFields,
  productCategories,
  productImages,
  productRelations,
  products,
  productThemes,
  productVariants,
  promotionCategories,
  promotionProducts,
  promotions,
  themes,
} from "../db/schema";
import { availabilityState, availableByVariant, type AvailabilityState } from "../inventory/availability";
import { bestPromotion, type AppliedPromotion, type PromotionRule } from "../pricing/engine";
import { publicMediaUrl } from "../storage";
import type { FieldDef } from "./personalization";

export type ImageData = { url: string; alt: string; width: number; height: number; isPlaceholder: boolean };

export type ProductCardData = {
  id: string;
  slug: string;
  name: string;
  shortDescription: string;
  image: ImageData | null;
  priceCents: number;
  regularPriceCents: number;
  /** true si el precio depende de variante o personalización → mostrar "Desde". */
  priceVaries: boolean;
  packUnits: number;
  unitLabel: string;
  personalizable: boolean;
  requiresPersonalization: boolean;
  availability: AvailabilityState;
  isQuoteOnly: boolean;
  promotions: AppliedPromotion[];
  createdAt: Date;
  /** Variante única comprable sin configuración (para "agregar rápido"). */
  quickAddVariantId: string | null;
  categoryIds: string[];
  themeIds: string[];
  tags: string[];
  isFeatured: boolean;
  featuredSort: number;
  minQty: number;
};

// ───────────────────────── Promociones ─────────────────────────

export async function loadPromotionRules(now: Date, tx: DbOrTx = db): Promise<PromotionRule[]> {
  const rows = await tx
    .select()
    .from(promotions)
    .where(and(eq(promotions.isActive, true), lte(promotions.startsAt, now), or(isNull(promotions.endsAt), gt(promotions.endsAt, now))));
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const [pp, pc] = await Promise.all([
    tx.select().from(promotionProducts).where(inArray(promotionProducts.promotionId, ids)),
    tx.select().from(promotionCategories).where(inArray(promotionCategories.promotionId, ids)),
  ]);
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    kind: r.kind,
    value: r.value,
    scope: r.scope,
    productIds: pp.filter((x) => x.promotionId === r.id).map((x) => x.productId),
    categoryIds: pc.filter((x) => x.promotionId === r.id).map((x) => x.categoryId),
    startsAt: r.startsAt,
    endsAt: r.endsAt,
    isActive: r.isActive,
    stackable: r.stackable,
    priority: r.priority,
  }));
}

// ───────────────────────── Cards ─────────────────────────

type BaseProductRow = typeof products.$inferSelect;

async function buildCards(rows: BaseProductRow[], now: Date): Promise<ProductCardData[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const [variants, images, cats, ths, fields, promos] = await Promise.all([
    db
      .select()
      .from(productVariants)
      .where(and(inArray(productVariants.productId, ids), eq(productVariants.isActive, true)))
      .orderBy(asc(productVariants.sort)),
    db
      .select({
        productId: productImages.productId,
        alt: productImages.alt,
        sort: productImages.sort,
        key: media.storageKey,
        width: media.width,
        height: media.height,
        mediaAlt: media.alt,
        isPlaceholder: media.isPlaceholder,
      })
      .from(productImages)
      .innerJoin(media, eq(media.id, productImages.mediaId))
      .where(inArray(productImages.productId, ids))
      .orderBy(asc(productImages.sort)),
    db.select().from(productCategories).where(inArray(productCategories.productId, ids)),
    db.select().from(productThemes).where(inArray(productThemes.productId, ids)),
    db
      .select({ productId: personalizationFields.productId, required: personalizationFields.required, type: personalizationFields.type })
      .from(personalizationFields)
      .where(inArray(personalizationFields.productId, ids)),
    loadPromotionRules(now),
  ]);
  const avail = await availableByVariant(variants.map((v) => v.id));

  return rows.map((p) => {
    const vs = variants.filter((v) => v.productId === p.id);
    const categoryIds = cats.filter((c) => c.productId === p.id).map((c) => c.categoryId);
    const pf = fields.filter((f) => f.productId === p.id);
    const img = images.find((i) => i.productId === p.id);

    let best: { price: number; regular: number; applied: AppliedPromotion[] } | null = null;
    const prices = new Set<number>();
    let totalAvailable = 0;
    let lowThreshold = 0;
    for (const v of vs) {
      const regular = v.priceCents ?? p.basePriceCents;
      const promo = bestPromotion(promos, p.id, categoryIds, regular, now);
      const price = regular - promo.unitDiscountCents;
      prices.add(price);
      const a = avail.get(v.id) ?? 0;
      totalAvailable += a;
      lowThreshold = Math.max(lowThreshold, v.lowStockThreshold);
      const buyable = a > 0 || p.allowBackorder;
      if (!best || (buyable && price < best.price)) best = { price, regular, applied: promo.applied };
    }
    const hasSurcharges = pf.length > 0;
    const requiresPersonalization = pf.some((f) => f.required);
    const availability = vs.length
      ? availabilityState({ available: totalAvailable, lowThreshold, inventoryMode: p.inventoryMode, allowBackorder: p.allowBackorder })
      : "out";
    const quickAddVariantId =
      vs.length === 1 && !requiresPersonalization && !p.isQuoteOnly && availability !== "out" ? vs[0].id : null;

    return {
      id: p.id,
      slug: p.slug,
      name: p.name,
      shortDescription: p.shortDescription,
      image: img
        ? {
            url: publicMediaUrl(img.key) ?? "",
            alt: img.alt || img.mediaAlt || p.name,
            width: img.width ?? 800,
            height: img.height ?? 800,
            isPlaceholder: img.isPlaceholder,
          }
        : null,
      priceCents: best?.price ?? p.basePriceCents,
      regularPriceCents: best?.regular ?? p.basePriceCents,
      priceVaries: prices.size > 1 || hasSurcharges,
      packUnits: p.packUnits,
      unitLabel: p.unitLabel,
      personalizable: pf.length > 0,
      requiresPersonalization,
      availability,
      isQuoteOnly: p.isQuoteOnly,
      promotions: best?.applied ?? [],
      createdAt: p.createdAt,
      quickAddVariantId,
      categoryIds,
      themeIds: ths.filter((t) => t.productId === p.id).map((t) => t.themeId),
      tags: p.tags,
      isFeatured: p.isFeatured,
      featuredSort: p.featuredSort,
      minQty: p.minQty,
    };
  });
}

// ───────────────────────── Listado con filtros ─────────────────────────

export type CatalogSort = "relevancia" | "novedades" | "precio-asc" | "precio-desc";

export type CatalogQuery = {
  q?: string;
  categorySlug?: string;
  themeSlug?: string;
  minPriceCents?: number;
  maxPriceCents?: number;
  onlyAvailable?: boolean;
  onlyPersonalizable?: boolean;
  onlyPromotions?: boolean;
  onlyFeatured?: boolean;
  sort?: CatalogSort;
  page?: number;
  pageSize?: number;
};

export function normalizeSearch(q: string): string {
  return q
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[%_\\]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

export async function searchCatalog(query: CatalogQuery, now = new Date()) {
  const pageSize = Math.min(Math.max(query.pageSize ?? 24, 1), 60);
  const page = Math.max(query.page ?? 1, 1);
  const conditions = [eq(products.status, "published")];

  if (query.categorySlug) {
    conditions.push(
      sql`${products.id} IN (SELECT pc.product_id FROM product_categories pc JOIN categories c ON c.id = pc.category_id WHERE c.slug = ${query.categorySlug} AND c.is_active)`,
    );
  }
  if (query.themeSlug) {
    conditions.push(
      sql`${products.id} IN (SELECT pt.product_id FROM product_themes pt JOIN themes t ON t.id = pt.theme_id WHERE t.slug = ${query.themeSlug} AND t.is_active)`,
    );
  }
  if (query.onlyFeatured) conditions.push(eq(products.isFeatured, true));

  const terms = query.q ? normalizeSearch(query.q).split(" ").filter(Boolean) : [];
  // Cada término debe aparecer en nombre/descripción/etiquetas o en categoría/temática.
  for (const term of terms) {
    const like = `%${term}%`;
    conditions.push(sql`(
      ck_product_search_text(${products.name}, ${products.shortDescription}, ${products.tags}) LIKE ${like}
      OR EXISTS (SELECT 1 FROM product_categories pc JOIN categories c ON c.id = pc.category_id WHERE pc.product_id = ${products.id} AND ck_normalize(c.name) LIKE ${like})
      OR EXISTS (SELECT 1 FROM product_themes pt JOIN themes t ON t.id = pt.theme_id WHERE pt.product_id = ${products.id} AND ck_normalize(t.name) LIKE ${like})
    )`);
  }

  const rows = await db.select().from(products).where(and(...conditions));
  let cards = await buildCards(rows, now);

  if (query.onlyAvailable) cards = cards.filter((c) => c.availability !== "out");
  if (query.onlyPersonalizable) cards = cards.filter((c) => c.personalizable);
  if (query.onlyPromotions) cards = cards.filter((c) => c.promotions.length > 0);
  if (query.minPriceCents != null) cards = cards.filter((c) => c.priceCents >= query.minPriceCents!);
  if (query.maxPriceCents != null) cards = cards.filter((c) => c.priceCents <= query.maxPriceCents!);

  const relevance = (c: ProductCardData) => {
    if (terms.length === 0) return 0;
    const name = normalizeSearch(c.name);
    return terms.reduce((s, t) => s + (name.startsWith(t) ? 3 : name.includes(t) ? 2 : 0), 0);
  };
  const sort = query.sort ?? "relevancia";
  cards.sort((a, b) => {
    // Los agotados van al final salvo que se ordene explícitamente por precio.
    const outDiff = Number(a.availability === "out") - Number(b.availability === "out");
    switch (sort) {
      case "precio-asc":
        return a.priceCents - b.priceCents || a.name.localeCompare(b.name);
      case "precio-desc":
        return b.priceCents - a.priceCents || a.name.localeCompare(b.name);
      case "novedades":
        return outDiff || b.createdAt.getTime() - a.createdAt.getTime();
      default:
        return (
          outDiff ||
          relevance(b) - relevance(a) ||
          Number(b.isFeatured) - Number(a.isFeatured) ||
          a.featuredSort - b.featuredSort ||
          a.name.localeCompare(b.name)
        );
    }
  });

  const total = cards.length;
  const start = (page - 1) * pageSize;
  return { items: cards.slice(start, start + pageSize), total, page, pageSize, pageCount: Math.max(1, Math.ceil(total / pageSize)) };
}

/** Sugerencias cuando no hay resultados: términos de categorías/temáticas parecidos. */
export async function searchSuggestions(q: string): Promise<{ label: string; href: string }[]> {
  const term = normalizeSearch(q);
  if (!term) return [];
  const rows = await db.execute<{ kind: string; name: string; slug: string }>(sql`
    SELECT 'categoria' AS kind, name, slug FROM categories WHERE is_active AND similarity(ck_normalize(name), ${term}) > 0.2
    UNION ALL
    SELECT 'tematica' AS kind, name, slug FROM themes WHERE is_active AND similarity(ck_normalize(name), ${term}) > 0.2
    UNION ALL
    SELECT 'producto' AS kind, name, slug FROM products WHERE status = 'published' AND similarity(ck_normalize(name), ${term}) > 0.25
    LIMIT 6`);
  return rows.map((r) => ({
    label: r.name,
    href: r.kind === "categoria" ? `/categorias/${r.slug}` : r.kind === "tematica" ? `/productos?tematica=${r.slug}` : `/productos/${r.slug}`,
  }));
}

export async function getFeaturedCards(limit = 8, now = new Date()) {
  const rows = await db
    .select()
    .from(products)
    .where(and(eq(products.status, "published"), eq(products.isFeatured, true)))
    .orderBy(asc(products.featuredSort), asc(products.name))
    .limit(limit);
  return buildCards(rows, now);
}

export async function getPromotionCards(limit = 8, now = new Date()) {
  const result = await searchCatalog({ onlyPromotions: true, pageSize: limit, sort: "relevancia" }, now);
  return result.items;
}

export async function getThemeCards(themeId: string, limit = 4, now = new Date()) {
  const rows = await db
    .select()
    .from(products)
    .where(and(eq(products.status, "published"), sql`${products.id} IN (SELECT product_id FROM product_themes WHERE theme_id = ${themeId})`))
    .orderBy(asc(products.featuredSort), asc(products.name))
    .limit(limit);
  return buildCards(rows, now);
}

// ───────────────────────── Categorías y temáticas ─────────────────────────

export const listActiveCategories = cache(async () => {
  const rows = await db
    .select({
      id: categories.id,
      slug: categories.slug,
      name: categories.name,
      description: categories.description,
      imageKey: media.storageKey,
      imageAlt: media.alt,
      isPlaceholder: media.isPlaceholder,
      productCount: sql<number>`(SELECT count(*)::int FROM product_categories pc JOIN products p ON p.id = pc.product_id WHERE pc.category_id = ${categories.id} AND p.status = 'published')`,
    })
    .from(categories)
    .leftJoin(media, eq(media.id, categories.imageId))
    .where(eq(categories.isActive, true))
    .orderBy(asc(categories.sort), asc(categories.name));
  return rows.map((r) => ({ ...r, imageUrl: publicMediaUrl(r.imageKey) }));
});

export const listActiveThemes = cache(async () => {
  const rows = await db
    .select({
      id: themes.id,
      slug: themes.slug,
      name: themes.name,
      description: themes.description,
      imageKey: media.storageKey,
      productCount: sql<number>`(SELECT count(*)::int FROM product_themes pt JOIN products p ON p.id = pt.product_id WHERE pt.theme_id = ${themes.id} AND p.status = 'published')`,
    })
    .from(themes)
    .leftJoin(media, eq(media.id, themes.imageId))
    .where(eq(themes.isActive, true))
    .orderBy(asc(themes.sort), asc(themes.name));
  return rows.map((r) => ({ ...r, imageUrl: publicMediaUrl(r.imageKey) }));
});

// ───────────────────────── Ficha ─────────────────────────

export type ProductDetail = NonNullable<Awaited<ReturnType<typeof getPublicProduct>>>;

export async function getPublicProduct(slug: string, now = new Date()) {
  const [p] = await db
    .select()
    .from(products)
    .where(and(eq(products.slug, slug), eq(products.status, "published")))
    .limit(1);
  if (!p) return null;
  return getProductDetail(p, now);
}

export async function getProductDetail(p: BaseProductRow, now = new Date()) {
  const [variants, images, cats, ths, fields, promos] = await Promise.all([
    db
      .select()
      .from(productVariants)
      .where(and(eq(productVariants.productId, p.id), eq(productVariants.isActive, true)))
      .orderBy(asc(productVariants.sort), asc(productVariants.name)),
    db
      .select({ id: productImages.id, alt: productImages.alt, key: media.storageKey, width: media.width, height: media.height, isPlaceholder: media.isPlaceholder })
      .from(productImages)
      .innerJoin(media, eq(media.id, productImages.mediaId))
      .where(eq(productImages.productId, p.id))
      .orderBy(asc(productImages.sort)),
    db
      .select({ id: categories.id, slug: categories.slug, name: categories.name })
      .from(productCategories)
      .innerJoin(categories, eq(categories.id, productCategories.categoryId))
      .where(eq(productCategories.productId, p.id))
      .orderBy(sql`${productCategories.isPrimary} DESC`, asc(categories.sort)),
    db
      .select({ id: themes.id, slug: themes.slug, name: themes.name })
      .from(productThemes)
      .innerJoin(themes, eq(themes.id, productThemes.themeId))
      .where(eq(productThemes.productId, p.id)),
    db.select().from(personalizationFields).where(eq(personalizationFields.productId, p.id)).orderBy(asc(personalizationFields.sort)),
    loadPromotionRules(now),
  ]);
  const avail = await availableByVariant(variants.map((v) => v.id));
  const categoryIds = cats.map((c) => c.id);

  const variantData = variants.map((v) => {
    const regular = v.priceCents ?? p.basePriceCents;
    const promo = bestPromotion(promos, p.id, categoryIds, regular, now);
    const available = avail.get(v.id) ?? 0;
    return {
      id: v.id,
      name: v.name,
      sku: v.sku,
      regularPriceCents: regular,
      priceCents: regular - promo.unitDiscountCents,
      promotions: promo.applied,
      available,
      availability: availabilityState({
        available,
        lowThreshold: v.lowStockThreshold,
        inventoryMode: p.inventoryMode,
        allowBackorder: p.allowBackorder,
      }),
    };
  });

  const fieldDefs: (FieldDef & { id: string; helpText: string; acceptMime: string[] | null; maxFileMb: number | null })[] = fields.map((f) => ({
    id: f.id,
    key: f.key,
    label: f.label,
    type: f.type,
    required: f.required,
    maxLength: f.maxLength,
    options: f.options,
    surchargeCents: f.surchargeCents,
    minLeadDays: f.minLeadDays,
    sort: f.sort,
    helpText: f.helpText,
    acceptMime: f.acceptMime,
    maxFileMb: f.maxFileMb,
  }));

  return {
    product: p,
    variants: variantData,
    images: images.map((i) => ({
      id: i.id,
      url: publicMediaUrl(i.key) ?? "",
      alt: i.alt || p.name,
      width: i.width ?? 800,
      height: i.height ?? 800,
      isPlaceholder: i.isPlaceholder,
    })),
    categories: cats,
    themes: ths,
    fields: fieldDefs,
  };
}

// ───────────────────────── Complementarios ─────────────────────────

export const COMPLEMENTS_MAX = 8;

/**
 * 1) Relaciones manuales válidas (en su orden).
 * 2) Reglas automáticas: categoría compatible según la matriz Y al menos una temática o etiqueta compartida.
 * Excluye el producto actual, duplicados, borradores/archivados, a presupuesto y agotados sin encargo.
 */
export async function getComplements(productId: string, now = new Date(), limit = COMPLEMENTS_MAX): Promise<ProductCardData[]> {
  const [self] = await db.select().from(products).where(eq(products.id, productId));
  if (!self) return [];

  const manual = await db
    .select({ p: products })
    .from(productRelations)
    .innerJoin(products, eq(products.id, productRelations.relatedProductId))
    .where(and(eq(productRelations.productId, productId), eq(products.status, "published")))
    .orderBy(asc(productRelations.sort));

  const valid = (c: ProductCardData) => c.id !== productId && !c.isQuoteOnly && c.availability !== "out";

  const manualCards = (await buildCards(manual.map((m) => m.p), now)).filter(valid);
  const orderedManual = manual.map((m) => manualCards.find((c) => c.id === m.p.id)).filter((c): c is ProductCardData => !!c);
  const result: ProductCardData[] = [...orderedManual];
  if (result.length >= limit) return result.slice(0, limit);

  const selfCats = await db.select().from(productCategories).where(eq(productCategories.productId, productId));
  const selfThemes = await db.select().from(productThemes).where(eq(productThemes.productId, productId));
  if (selfCats.length === 0) return result;
  const compatible = await db
    .select()
    .from(categoryComplements)
    .where(inArray(categoryComplements.categoryId, selfCats.map((c) => c.categoryId)));
  if (compatible.length === 0) return result;
  const compatibleIds = compatible.map((c) => c.complementCategoryId);

  const candidates = await db
    .select({ p: products })
    .from(products)
    .where(
      and(
        eq(products.status, "published"),
        sql`${products.id} <> ${productId}`,
        sql`${products.id} IN (SELECT product_id FROM product_categories WHERE category_id IN ${compatibleIds})`,
      ),
    );
  const cards = (await buildCards(candidates.map((c) => c.p), now)).filter(valid);
  const selfThemeIds = new Set(selfThemes.map((t) => t.themeId));
  const selfTags = new Set(self.tags.map((t) => t.toLowerCase()));
  const scored = cards
    .map((c) => ({
      c,
      shared: c.themeIds.filter((t) => selfThemeIds.has(t)).length + c.tags.filter((t) => selfTags.has(t.toLowerCase())).length,
      catOrder: Math.min(...c.categoryIds.map((id) => compatible.find((x) => x.complementCategoryId === id)?.sort ?? 99)),
    }))
    .filter((x) => x.shared > 0 && !result.some((r) => r.id === x.c.id))
    .sort((a, b) => b.shared - a.shared || a.catOrder - b.catOrder || a.c.name.localeCompare(b.c.name));

  for (const s of scored) {
    if (result.length >= limit) break;
    result.push(s.c);
  }
  return result;
}
