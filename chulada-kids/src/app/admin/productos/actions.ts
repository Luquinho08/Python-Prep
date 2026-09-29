"use server";
import { and, asc, eq, max, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import {
  orderLines,
  personalizationFields,
  productCategories,
  productImages,
  productRelations,
  products,
  productThemes,
  productVariants,
  stockReservations,
} from "@/lib/db/schema";
import { requirePermission } from "@/lib/auth/guards";
import { audit } from "@/lib/audit";
import { redirectError, redirectOk, zodMessage } from "@/lib/admin/flash";
import { parsePesosInput } from "@/lib/money";
import { plainTextToHtml, sanitizeRichText } from "@/lib/content/sanitize";
import { deleteMediaIfUnused } from "@/lib/storage";
import { slugify } from "@/lib/slug";
import { redirect } from "next/navigation";

const uuid = z.string().uuid();
const bool = (v: FormDataEntryValue | null) => v === "on" || v === "1" || v === "true";
const int = (v: FormDataEntryValue | null, fallback: number | null = 0) => {
  const s = String(v ?? "").trim();
  if (s === "") return fallback;
  const n = Number(s);
  return Number.isFinite(n) ? Math.trunc(n) : NaN;
};

const productSchema = z
  .object({
    name: z.string().trim().min(2, "El nombre es obligatorio").max(120),
    slug: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "Solo minúsculas, números y guiones").max(120),
    sku: z.string().trim().min(2, "El SKU es obligatorio").max(40).regex(/^[A-Za-z0-9._-]+$/, "SKU: letras, números, punto, guion"),
    shortDescription: z.string().trim().max(240),
    longDescriptionHtml: z.string().max(20000),
    basePriceCents: z.number().int().min(0, "Precio inválido"),
    packUnits: z.number().int().min(1).max(10000),
    unitLabel: z.string().trim().min(1).max(30),
    minQty: z.number().int().min(1).max(10000),
    qtyStep: z.number().int().min(1).max(1000),
    maxQty: z.number().int().min(1).nullable(),
    inventoryMode: z.enum(["stock", "capacity"]),
    allowBackorder: z.boolean(),
    productionDaysMin: z.number().int().min(0).max(120),
    productionDaysMax: z.number().int().min(0).max(120),
    packContents: z.string().max(500),
    materials: z.string().max(500),
    dimensions: z.string().max(500),
    deliveryNotes: z.string().max(500),
    weightGrams: z.number().int().min(0).nullable(),
    isQuoteOnly: z.boolean(),
    requiresDesignApproval: z.boolean(),
    isFeatured: z.boolean(),
    featuredSort: z.number().int(),
    tags: z.array(z.string().max(40)).max(30),
    seoTitle: z.string().max(70).nullable(),
    seoDescription: z.string().max(170).nullable(),
    status: z.enum(["draft", "published", "archived"]),
  })
  .refine((d) => d.productionDaysMax >= d.productionDaysMin, { message: "La elaboración máxima debe ser ≥ la mínima", path: ["productionDaysMax"] })
  .refine((d) => d.maxQty === null || d.maxQty >= d.minQty, { message: "El máximo debe ser ≥ al mínimo", path: ["maxQty"] });

async function publishProblems(productId: string, data: { basePriceCents: number; isQuoteOnly: boolean }, categoryIds: string[]) {
  const problems: string[] = [];
  const [variants, images] = await Promise.all([
    db.select().from(productVariants).where(and(eq(productVariants.productId, productId), eq(productVariants.isActive, true))),
    db.select().from(productImages).where(eq(productImages.productId, productId)),
  ]);
  if (variants.length === 0) problems.push("agregá al menos una variante activa");
  if (images.length === 0) problems.push("subí al menos una imagen");
  if (images.some((i) => !i.alt.trim())) problems.push("completá el texto alternativo de todas las imágenes");
  if (categoryIds.length === 0) problems.push("elegí al menos una categoría");
  if (!data.isQuoteOnly && data.basePriceCents <= 0 && variants.some((v) => (v.priceCents ?? data.basePriceCents) <= 0))
    problems.push("definí un precio mayor a cero (o marcalo como producto a presupuesto)");
  return problems;
}

export async function saveProductAction(formData: FormData) {
  const user = await requirePermission("catalog:write");
  const id = formData.get("id") ? uuid.parse(formData.get("id")) : null;
  const back = id ? `/admin/productos/${id}` : "/admin/productos/nuevo";
  const price = parsePesosInput(String(formData.get("basePrice") ?? ""));
  const name = String(formData.get("name") ?? "").trim();
  const raw = {
    name,
    slug: slugify(String(formData.get("slug") ?? "").trim() || name),
    sku: String(formData.get("sku") ?? "").trim().toUpperCase(),
    shortDescription: String(formData.get("shortDescription") ?? ""),
    longDescriptionHtml: sanitizeRichText(plainTextToHtml(String(formData.get("longDescription") ?? ""))),
    basePriceCents: price ?? NaN,
    packUnits: int(formData.get("packUnits"), 1),
    unitLabel: String(formData.get("unitLabel") ?? "unidad"),
    minQty: int(formData.get("minQty"), 1),
    qtyStep: int(formData.get("qtyStep"), 1),
    maxQty: int(formData.get("maxQty"), null),
    inventoryMode: String(formData.get("inventoryMode") ?? "stock"),
    allowBackorder: bool(formData.get("allowBackorder")),
    productionDaysMin: int(formData.get("productionDaysMin"), 0),
    productionDaysMax: int(formData.get("productionDaysMax"), 0),
    packContents: String(formData.get("packContents") ?? ""),
    materials: String(formData.get("materials") ?? ""),
    dimensions: String(formData.get("dimensions") ?? ""),
    deliveryNotes: String(formData.get("deliveryNotes") ?? ""),
    weightGrams: int(formData.get("weightGrams"), null),
    isQuoteOnly: bool(formData.get("isQuoteOnly")),
    requiresDesignApproval: bool(formData.get("requiresDesignApproval")),
    isFeatured: bool(formData.get("isFeatured")),
    featuredSort: int(formData.get("featuredSort"), 0),
    tags: String(formData.get("tags") ?? "")
      .split(",")
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean),
    seoTitle: String(formData.get("seoTitle") ?? "").trim() || null,
    seoDescription: String(formData.get("seoDescription") ?? "").trim() || null,
    status: String(formData.get("status") ?? "draft"),
  };
  const parsed = productSchema.safeParse(raw);
  if (!parsed.success) redirectError(back, `Revisá: ${zodMessage(parsed.error.issues)}`);
  const data = parsed.data;
  const categoryIds = formData.getAll("categoryIds").map(String).filter((x) => uuid.safeParse(x).success);
  const primaryCategory = String(formData.get("primaryCategoryId") ?? "");
  const themeIds = formData.getAll("themeIds").map(String).filter((x) => uuid.safeParse(x).success);

  const [slugTaken] = await db.select({ id: products.id }).from(products).where(and(eq(products.slug, data.slug), id ? ne(products.id, id) : sql`true`));
  if (slugTaken) redirectError(back, `El slug “${data.slug}” ya está en uso.`);
  const [skuTaken] = await db.select({ id: products.id }).from(products).where(and(eq(products.sku, data.sku), id ? ne(products.id, id) : sql`true`));
  if (skuTaken) redirectError(back, `El SKU “${data.sku}” ya está en uso.`);

  let productId = id;
  let requestedStatus = data.status;
  if (!productId) requestedStatus = "draft"; // se crea en borrador; se publica tras cargar variantes e imágenes.

  await db.transaction(async (tx) => {
    const now = new Date();
    if (productId) {
      const [prev] = await tx.select().from(products).where(eq(products.id, productId));
      if (!prev) throw new Error("Producto inexistente");
      await tx
        .update(products)
        .set({
          ...data,
          status: prev.status,
          updatedAt: now,
        })
        .where(eq(products.id, productId));
    } else {
      const [row] = await tx.insert(products).values({ ...data, status: "draft" }).returning();
      productId = row.id;
      await tx.insert(productVariants).values({ productId: row.id, sku: `${data.sku}-1`, name: "Única", stockOnHand: 0 });
    }
    await tx.delete(productCategories).where(eq(productCategories.productId, productId!));
    if (categoryIds.length) {
      await tx
        .insert(productCategories)
        .values(categoryIds.map((c, i) => ({ productId: productId!, categoryId: c, isPrimary: primaryCategory ? c === primaryCategory : i === 0 })));
    }
    await tx.delete(productThemes).where(eq(productThemes.productId, productId!));
    if (themeIds.length) await tx.insert(productThemes).values(themeIds.map((t) => ({ productId: productId!, themeId: t })));
  });

  // Transición de estado con validaciones de publicación.
  let msg = id ? "Producto guardado." : "Producto creado como borrador. Cargá variantes e imágenes y publicalo.";
  if (id) {
    const [current] = await db.select().from(products).where(eq(products.id, productId!));
    if (requestedStatus !== current.status) {
      if (requestedStatus === "published") {
        const problems = await publishProblems(productId!, data, categoryIds);
        if (problems.length) {
          await audit(user.id, "product.update", "product", productId, { sku: data.sku });
          redirectError(back, `Se guardaron los cambios, pero no se pudo publicar: ${problems.join("; ")}.`);
        }
        await db.update(products).set({ status: "published", publishedAt: current.publishedAt ?? new Date(), archivedAt: null }).where(eq(products.id, productId!));
        msg = "Producto guardado y publicado.";
      } else if (requestedStatus === "archived") {
        await db.update(products).set({ status: "archived", archivedAt: new Date() }).where(eq(products.id, productId!));
        msg = "Producto archivado (se conserva para pedidos históricos).";
      } else {
        await db.update(products).set({ status: "draft" }).where(eq(products.id, productId!));
        msg = "Producto guardado como borrador (ya no se ve en la tienda).";
      }
    }
  }
  await audit(user.id, id ? "product.update" : "product.create", "product", productId, { sku: data.sku, status: requestedStatus });
  redirectOk(`/admin/productos/${productId}`, msg);
}

export async function duplicateProductAction(formData: FormData) {
  const user = await requirePermission("catalog:write");
  const id = uuid.parse(formData.get("id"));
  const [p] = await db.select().from(products).where(eq(products.id, id));
  if (!p) redirectError("/admin/productos", "Producto inexistente.");
  const suffix = Math.random().toString(36).slice(2, 6).toUpperCase();
  const newId = await db.transaction(async (tx) => {
    const { id: _omit, createdAt: _c, updatedAt: _u, ...rest } = p;
    void _omit; void _c; void _u;
    const [copy] = await tx
      .insert(products)
      .values({ ...rest, name: `${p.name} (copia)`, slug: `${p.slug}-copia-${suffix.toLowerCase()}`, sku: `${p.sku}-C${suffix}`, status: "draft", publishedAt: null, archivedAt: null, isFeatured: false, isDemo: false })
      .returning();
    const variants = await tx.select().from(productVariants).where(eq(productVariants.productId, id));
    if (variants.length)
      await tx.insert(productVariants).values(variants.map((v) => ({ productId: copy.id, sku: `${v.sku}-C${suffix}`, name: v.name, priceCents: v.priceCents, stockOnHand: 0, lowStockThreshold: v.lowStockThreshold, isActive: v.isActive, sort: v.sort })));
    const cats = await tx.select().from(productCategories).where(eq(productCategories.productId, id));
    if (cats.length) await tx.insert(productCategories).values(cats.map((c) => ({ ...c, productId: copy.id })));
    const ths = await tx.select().from(productThemes).where(eq(productThemes.productId, id));
    if (ths.length) await tx.insert(productThemes).values(ths.map((t) => ({ ...t, productId: copy.id })));
    const fields = await tx.select().from(personalizationFields).where(eq(personalizationFields.productId, id));
    if (fields.length) await tx.insert(personalizationFields).values(fields.map(({ id: _f, ...f }) => { void _f; return { ...f, productId: copy.id }; }));
    const imgs = await tx.select().from(productImages).where(eq(productImages.productId, id));
    if (imgs.length) await tx.insert(productImages).values(imgs.map(({ id: _i, ...i }) => { void _i; return { ...i, productId: copy.id }; }));
    return copy.id;
  });
  await audit(user.id, "product.duplicate", "product", newId, { from: id });
  redirectOk(`/admin/productos/${newId}`, "Copia creada como borrador. El stock de las variantes empieza en 0.");
}

export async function deleteProductAction(formData: FormData) {
  const user = await requirePermission("catalog:write");
  const id = uuid.parse(formData.get("id"));
  const [used] = await db.select({ n: sql<number>`count(*)::int` }).from(orderLines).where(eq(orderLines.productId, id));
  if (Number(used.n) > 0) {
    await db.update(products).set({ status: "archived", archivedAt: new Date() }).where(eq(products.id, id));
    await audit(user.id, "product.archive", "product", id);
    redirectOk(`/admin/productos/${id}`, "El producto tiene pedidos: se archivó en lugar de eliminarse.");
  }
  const imgs = await db.select().from(productImages).where(eq(productImages.productId, id));
  await db.delete(products).where(eq(products.id, id));
  for (const i of imgs) await deleteMediaIfUnused(i.mediaId);
  await audit(user.id, "product.delete", "product", id);
  redirectOk("/admin/productos", "Producto eliminado.");
}

// ───────────── Variantes ─────────────

export async function saveVariantAction(formData: FormData) {
  const user = await requirePermission("catalog:write");
  const productId = uuid.parse(formData.get("productId"));
  const id = formData.get("id") ? uuid.parse(formData.get("id")) : null;
  const back = `/admin/productos/${productId}#variantes`;
  const priceRaw = String(formData.get("price") ?? "").trim();
  const price = priceRaw ? parsePesosInput(priceRaw) : null;
  const schema = z.object({
    name: z.string().trim().min(1, "Nombre obligatorio").max(80),
    sku: z.string().trim().min(2).max(50).regex(/^[A-Za-z0-9._-]+$/, "SKU inválido"),
    stockOnHand: z.number().int().min(0, "El stock no puede ser negativo").max(1_000_000),
    lowStockThreshold: z.number().int().min(0).max(10000),
    sort: z.number().int(),
  });
  const parsed = schema.safeParse({
    name: formData.get("name"),
    sku: String(formData.get("sku") ?? "").toUpperCase(),
    stockOnHand: int(formData.get("stockOnHand"), 0),
    lowStockThreshold: int(formData.get("lowStockThreshold"), 3),
    sort: int(formData.get("sort"), 0),
  });
  if (!parsed.success) redirectError(back, `Variante: ${zodMessage(parsed.error.issues)}`);
  if (priceRaw && price === null) redirectError(back, "Precio de variante inválido.");
  const [dup] = await db.select({ id: productVariants.id }).from(productVariants).where(and(eq(productVariants.sku, parsed.data.sku), id ? ne(productVariants.id, id) : sql`true`));
  if (dup) redirectError(back, `El SKU ${parsed.data.sku} ya existe.`);
  const values = { ...parsed.data, priceCents: price, isActive: bool(formData.get("isActive")) || !id, updatedAt: new Date() };
  if (id) {
    const [prev] = await db.select().from(productVariants).where(and(eq(productVariants.id, id), eq(productVariants.productId, productId)));
    if (!prev) redirectError(back, "Variante inexistente.");
    await db.update(productVariants).set(values).where(eq(productVariants.id, id));
    await audit(user.id, "variant.update", "variant", id, { sku: values.sku, stockFrom: prev.stockOnHand, stockTo: values.stockOnHand, priceFrom: prev.priceCents, priceTo: values.priceCents });
  } else {
    const [row] = await db.insert(productVariants).values({ ...values, productId }).returning();
    await audit(user.id, "variant.create", "variant", row.id, { sku: values.sku });
  }
  await db.update(products).set({ updatedAt: new Date() }).where(eq(products.id, productId));
  redirectOk(back.replace("#variantes", ""), "Variante guardada.");
}

export async function deleteVariantAction(formData: FormData) {
  const user = await requirePermission("catalog:write");
  const productId = uuid.parse(formData.get("productId"));
  const id = uuid.parse(formData.get("id"));
  const [used] = await db.select({ n: sql<number>`count(*)::int` }).from(orderLines).where(eq(orderLines.variantId, id));
  const [res] = await db.select({ n: sql<number>`count(*)::int` }).from(stockReservations).where(eq(stockReservations.variantId, id));
  if (Number(used.n) > 0 || Number(res.n) > 0) {
    await db.update(productVariants).set({ isActive: false }).where(eq(productVariants.id, id));
    await audit(user.id, "variant.deactivate", "variant", id);
    redirectOk(`/admin/productos/${productId}`, "La variante tiene pedidos: se desactivó en lugar de eliminarse.");
  }
  await db.delete(productVariants).where(and(eq(productVariants.id, id), eq(productVariants.productId, productId)));
  await audit(user.id, "variant.delete", "variant", id);
  redirectOk(`/admin/productos/${productId}`, "Variante eliminada.");
}

// ───────────── Imágenes ─────────────

export async function updateImageAction(formData: FormData) {
  await requirePermission("catalog:write");
  const productId = uuid.parse(formData.get("productId"));
  const id = uuid.parse(formData.get("id"));
  const alt = String(formData.get("alt") ?? "").trim().slice(0, 200);
  const dir = String(formData.get("move") ?? "");
  if (dir === "up" || dir === "down") {
    const imgs = await db.select().from(productImages).where(eq(productImages.productId, productId)).orderBy(asc(productImages.sort), asc(productImages.id));
    const idx = imgs.findIndex((i) => i.id === id);
    const swap = dir === "up" ? idx - 1 : idx + 1;
    if (idx >= 0 && swap >= 0 && swap < imgs.length) {
      const order = [...imgs];
      [order[idx], order[swap]] = [order[swap], order[idx]];
      await db.transaction(async (tx) => {
        for (const [i, img] of order.entries()) await tx.update(productImages).set({ sort: i }).where(eq(productImages.id, img.id));
      });
    }
    redirect(`/admin/productos/${productId}#imagenes`);
  }
  await db.update(productImages).set({ alt }).where(and(eq(productImages.id, id), eq(productImages.productId, productId)));
  redirectOk(`/admin/productos/${productId}`, "Texto alternativo guardado.");
}

export async function removeImageAction(formData: FormData) {
  const user = await requirePermission("catalog:write");
  const productId = uuid.parse(formData.get("productId"));
  const id = uuid.parse(formData.get("id"));
  const [img] = await db.delete(productImages).where(and(eq(productImages.id, id), eq(productImages.productId, productId))).returning();
  if (img) {
    const deleted = await deleteMediaIfUnused(img.mediaId);
    await audit(user.id, "image.remove", "product", productId, { mediaId: img.mediaId, fileDeleted: deleted });
  }
  redirectOk(`/admin/productos/${productId}`, "Imagen quitada.");
}

// ───────────── Personalización ─────────────

export async function saveFieldAction(formData: FormData) {
  const user = await requirePermission("catalog:write");
  const productId = uuid.parse(formData.get("productId"));
  const id = formData.get("id") ? uuid.parse(formData.get("id")) : null;
  const back = `/admin/productos/${productId}`;
  const type = String(formData.get("type") ?? "text");
  const options = String(formData.get("options") ?? "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const [value, label, surcharge] = l.split("|").map((s) => s.trim());
      const cents = surcharge ? parsePesosInput(surcharge) : 0;
      return { value: slugify(value) || value, label: label || value, ...(cents ? { surchargeCents: cents } : {}) };
    });
  const surcharge = parsePesosInput(String(formData.get("surcharge") ?? "")) ?? 0;
  const schema = z.object({
    key: z.string().regex(/^[a-z0-9_]{1,30}$/, "Clave: minúsculas, números y guion bajo"),
    label: z.string().trim().min(1).max(80),
    type: z.enum(["text", "textarea", "select", "date", "file"]),
    maxLength: z.number().int().min(1).max(1000).nullable(),
    minLeadDays: z.number().int().min(0).max(365).nullable(),
    maxFileMb: z.number().int().min(1).max(8).nullable(),
    sort: z.number().int(),
  });
  const parsed = schema.safeParse({
    key: String(formData.get("key") ?? "").trim().toLowerCase().replace(/-/g, "_") || slugify(String(formData.get("label") ?? "")).replace(/-/g, "_"),
    label: formData.get("label"),
    type,
    maxLength: int(formData.get("maxLength"), null),
    minLeadDays: int(formData.get("minLeadDays"), null),
    maxFileMb: int(formData.get("maxFileMb"), null),
    sort: int(formData.get("sort"), 0),
  });
  if (!parsed.success) redirectError(back, `Campo: ${zodMessage(parsed.error.issues)}`);
  if (type === "select" && options.length === 0) redirectError(back, "Un campo de selección necesita al menos una opción (una por línea: valor|Etiqueta|recargo).");
  const values = {
    ...parsed.data,
    required: bool(formData.get("required")),
    helpText: String(formData.get("helpText") ?? "").slice(0, 200),
    options: type === "select" ? options : [],
    surchargeCents: surcharge,
    acceptMime: type === "file" ? ["image/jpeg", "image/png", "image/webp", ...(bool(formData.get("acceptPdf")) ? ["application/pdf"] : [])] : null,
  };
  try {
    if (id) await db.update(personalizationFields).set(values).where(and(eq(personalizationFields.id, id), eq(personalizationFields.productId, productId)));
    else await db.insert(personalizationFields).values({ ...values, productId });
  } catch {
    redirectError(back, `Ya existe un campo con la clave “${values.key}”.`);
  }
  await audit(user.id, "personalization.save", "product", productId, { key: values.key });
  redirectOk(back, "Campo de personalización guardado. Los carritos con datos incompatibles pedirán corregirlos.");
}

export async function deleteFieldAction(formData: FormData) {
  const user = await requirePermission("catalog:write");
  const productId = uuid.parse(formData.get("productId"));
  const id = uuid.parse(formData.get("id"));
  await db.delete(personalizationFields).where(and(eq(personalizationFields.id, id), eq(personalizationFields.productId, productId)));
  await audit(user.id, "personalization.delete", "product", productId, { fieldId: id });
  redirectOk(`/admin/productos/${productId}`, "Campo eliminado. Los pedidos existentes conservan los datos cargados.");
}

// ───────────── Complementarios manuales ─────────────

export async function addRelationAction(formData: FormData) {
  const user = await requirePermission("catalog:write");
  const productId = uuid.parse(formData.get("productId"));
  const relatedId = uuid.safeParse(formData.get("relatedId"));
  const back = `/admin/productos/${productId}`;
  if (!relatedId.success || relatedId.data === productId) redirectError(back, "Elegí otro producto.");
  const reciprocal = bool(formData.get("reciprocal"));
  const [{ m }] = await db.select({ m: max(productRelations.sort) }).from(productRelations).where(eq(productRelations.productId, productId));
  await db.insert(productRelations).values({ productId, relatedProductId: relatedId.data, sort: (m ?? 0) + 1 }).onConflictDoNothing();
  if (reciprocal) {
    const [{ m: m2 }] = await db.select({ m: max(productRelations.sort) }).from(productRelations).where(eq(productRelations.productId, relatedId.data));
    await db.insert(productRelations).values({ productId: relatedId.data, relatedProductId: productId, sort: (m2 ?? 0) + 1 }).onConflictDoNothing();
  }
  await audit(user.id, "relation.add", "product", productId, { relatedId: relatedId.data, reciprocal });
  redirectOk(back, reciprocal ? "Complemento agregado en ambos sentidos." : "Complemento agregado.");
}

export async function updateRelationAction(formData: FormData) {
  const user = await requirePermission("catalog:write");
  const productId = uuid.parse(formData.get("productId"));
  const relatedId = uuid.parse(formData.get("relatedId"));
  const op = String(formData.get("op"));
  if (op === "remove") {
    await db.delete(productRelations).where(and(eq(productRelations.productId, productId), eq(productRelations.relatedProductId, relatedId)));
    await audit(user.id, "relation.remove", "product", productId, { relatedId });
    redirectOk(`/admin/productos/${productId}`, "Complemento quitado.");
  }
  const rels = await db.select().from(productRelations).where(eq(productRelations.productId, productId)).orderBy(asc(productRelations.sort));
  const idx = rels.findIndex((r) => r.relatedProductId === relatedId);
  const swap = op === "up" ? idx - 1 : idx + 1;
  if (idx >= 0 && swap >= 0 && swap < rels.length) {
    [rels[idx], rels[swap]] = [rels[swap], rels[idx]];
    await db.transaction(async (tx) => {
      for (const [i, r] of rels.entries())
        await tx.update(productRelations).set({ sort: i }).where(and(eq(productRelations.productId, productId), eq(productRelations.relatedProductId, r.relatedProductId)));
    });
  }
  redirect(`/admin/productos/${productId}#complementarios`);
}

export async function bulkFeaturedAction(formData: FormData) {
  const user = await requirePermission("catalog:write");
  const ids = formData.getAll("id").map(String).filter((x) => uuid.safeParse(x).success);
  await db.transaction(async (tx) => {
    for (const id of ids) {
      const sort = int(formData.get(`sort_${id}`), 0);
      await tx.update(products).set({ featuredSort: sort == null || Number.isNaN(sort) ? 0 : sort, isFeatured: bool(formData.get(`featured_${id}`)) }).where(eq(products.id, id));
    }
  });
  await audit(user.id, "featured.update", "product", null, { ids });
  redirectOk("/admin/productos?destacados=1", "Destacados actualizados.");
}
