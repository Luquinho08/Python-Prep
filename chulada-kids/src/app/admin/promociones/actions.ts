"use server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { coupons, promotionCategories, promotionProducts, promotions } from "@/lib/db/schema";
import { requirePermission } from "@/lib/auth/guards";
import { audit } from "@/lib/audit";
import { redirectError, redirectOk, zodMessage } from "@/lib/admin/flash";
import { parsePesosInput } from "@/lib/money";
import { storeLocalToUtc } from "@/lib/time";

function dateField(v: FormDataEntryValue | null): Date | null {
  const s = String(v ?? "").trim();
  if (!s) return null;
  try {
    return storeLocalToUtc(s);
  } catch {
    return new Date(NaN);
  }
}

/** percent: "15" o "12,5" → basis points; fixed: pesos → centavos. */
function discountValue(kind: string, raw: string): number | null {
  if (kind === "percent") {
    const n = Number(raw.replace(",", "."));
    if (!Number.isFinite(n) || n <= 0 || n > 100) return null;
    return Math.round(n * 100);
  }
  const c = parsePesosInput(raw);
  return c && c > 0 ? c : null;
}

export async function savePromotionAction(formData: FormData) {
  const user = await requirePermission("promotions:write");
  const id = String(formData.get("id") ?? "") || null;
  const back = id ? `/admin/promociones?editar=${id}` : "/admin/promociones";
  const kind = String(formData.get("kind"));
  const value = discountValue(kind, String(formData.get("value") ?? ""));
  if (value === null) redirectError(back, kind === "percent" ? "El porcentaje debe estar entre 0 y 100." : "Ingresá un monto mayor a cero.");
  const parsed = z
    .object({
      name: z.string().trim().min(2).max(80),
      kind: z.enum(["percent", "fixed"]),
      scope: z.enum(["products", "categories", "all"]),
      startsAt: z.date({ message: "Fecha de inicio inválida" }),
      endsAt: z.date().nullable(),
      priority: z.number().int(),
    })
    .refine((d) => !d.endsAt || d.endsAt > d.startsAt, { message: "El fin debe ser posterior al inicio", path: ["endsAt"] })
    .safeParse({
      name: formData.get("name"),
      kind,
      scope: formData.get("scope"),
      startsAt: dateField(formData.get("startsAt")) ?? undefined,
      endsAt: dateField(formData.get("endsAt")),
      priority: Number(formData.get("priority") ?? 0) || 0,
    });
  if (!parsed.success) redirectError(back, zodMessage(parsed.error.issues));
  const productIds = formData.getAll("productIds").map(String);
  const categoryIds = formData.getAll("categoryIds").map(String);
  if (parsed.data.scope === "products" && productIds.length === 0) redirectError(back, "Elegí al menos un producto.");
  if (parsed.data.scope === "categories" && categoryIds.length === 0) redirectError(back, "Elegí al menos una categoría.");
  const values = { ...parsed.data, value, isActive: formData.get("isActive") === "on", stackable: formData.get("stackable") === "on", updatedAt: new Date() };
  const promoId = await db.transaction(async (tx) => {
    let pid = id;
    if (pid) await tx.update(promotions).set(values).where(eq(promotions.id, pid));
    else pid = (await tx.insert(promotions).values(values).returning())[0].id;
    await tx.delete(promotionProducts).where(eq(promotionProducts.promotionId, pid!));
    await tx.delete(promotionCategories).where(eq(promotionCategories.promotionId, pid!));
    if (values.scope === "products") await tx.insert(promotionProducts).values(productIds.map((p) => ({ promotionId: pid!, productId: p })));
    if (values.scope === "categories") await tx.insert(promotionCategories).values(categoryIds.map((c) => ({ promotionId: pid!, categoryId: c })));
    return pid!;
  });
  await audit(user.id, "promotion.save", "promotion", promoId, { ...values });
  redirectOk(`/admin/promociones?editar=${promoId}`, "Promoción guardada. Revisá la vista previa de precios.");
}

export async function deletePromotionAction(formData: FormData) {
  const user = await requirePermission("promotions:write");
  const id = z.string().uuid().parse(formData.get("id"));
  await db.delete(promotions).where(eq(promotions.id, id));
  await audit(user.id, "promotion.delete", "promotion", id);
  redirectOk("/admin/promociones", "Promoción eliminada. Los pedidos existentes conservan el precio con que se cobraron.");
}

export async function saveCouponAction(formData: FormData) {
  const user = await requirePermission("promotions:write");
  const id = String(formData.get("id") ?? "") || null;
  const back = "/admin/cupones";
  const kind = String(formData.get("kind"));
  const value = discountValue(kind, String(formData.get("value") ?? ""));
  if (value === null) redirectError(back, "Valor de descuento inválido.");
  const intOrNull = (v: FormDataEntryValue | null) => (String(v ?? "").trim() ? Math.trunc(Number(v)) : null);
  const parsed = z
    .object({
      code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_-]{3,30}$/, "Código: 3 a 30 letras, números, guion"),
      description: z.string().max(200),
      kind: z.enum(["percent", "fixed"]),
      minSubtotalCents: z.number().int().min(0),
      startsAt: z.date().nullable(),
      endsAt: z.date().nullable(),
      maxUses: z.number().int().min(1).nullable(),
      maxUsesPerCustomer: z.number().int().min(1).nullable(),
    })
    .safeParse({
      code: formData.get("code"),
      description: String(formData.get("description") ?? ""),
      kind,
      minSubtotalCents: parsePesosInput(String(formData.get("minSubtotal") ?? "")) ?? 0,
      startsAt: dateField(formData.get("startsAt")),
      endsAt: dateField(formData.get("endsAt")),
      maxUses: intOrNull(formData.get("maxUses")),
      maxUsesPerCustomer: intOrNull(formData.get("maxUsesPerCustomer")),
    });
  if (!parsed.success) redirectError(back, zodMessage(parsed.error.issues));
  const values = { ...parsed.data, value, combinableWithPromotions: formData.get("combinable") === "on", isActive: formData.get("isActive") === "on", updatedAt: new Date() };
  try {
    if (id) await db.update(coupons).set(values).where(eq(coupons.id, id));
    else await db.insert(coupons).values(values);
  } catch {
    redirectError(back, `El código ${values.code} ya existe.`);
  }
  await audit(user.id, "coupon.save", "coupon", id, { code: values.code });
  redirectOk(back, `Cupón ${values.code} guardado.`);
}
