"use server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { shippingMethods } from "@/lib/db/schema";
import { requirePermission } from "@/lib/auth/guards";
import { audit } from "@/lib/audit";
import { redirectError, redirectOk, zodMessage } from "@/lib/admin/flash";
import { parsePesosInput } from "@/lib/money";
import { validPostalRules } from "@/lib/shipping";

export async function saveShippingAction(formData: FormData) {
  const user = await requirePermission("shipping:write");
  const id = String(formData.get("id") ?? "") || null;
  const back = "/admin/entregas";
  const rules = String(formData.get("postalCodes") ?? "").split(/[,\n]/).map((s) => s.trim()).filter(Boolean);
  if (!validPostalRules(rules)) redirectError(back, "Códigos postales inválidos. Usá 4 dígitos (1425) o rangos (1000-1499), separados por coma.");
  const parsed = z
    .object({
      name: z.string().trim().min(2).max(80),
      kind: z.enum(["pickup", "delivery"]),
      description: z.string().max(400),
      priceCents: z.number().int().min(0, "Costo inválido"),
      deliveryDaysMin: z.number().int().min(0).max(60),
      deliveryDaysMax: z.number().int().min(0).max(60),
      sort: z.number().int(),
    })
    .refine((d) => d.deliveryDaysMax >= d.deliveryDaysMin, { message: "El plazo máximo debe ser ≥ al mínimo" })
    .safeParse({
      name: formData.get("name"),
      kind: formData.get("kind"),
      description: String(formData.get("description") ?? ""),
      priceCents: parsePesosInput(String(formData.get("price") ?? "0")) ?? NaN,
      deliveryDaysMin: Number(formData.get("deliveryDaysMin") ?? 0),
      deliveryDaysMax: Number(formData.get("deliveryDaysMax") ?? 0),
      sort: Number(formData.get("sort") ?? 0) || 0,
    });
  if (!parsed.success) redirectError(back, zodMessage(parsed.error.issues));
  if (parsed.data.kind === "delivery" && rules.length === 0) redirectError(back, "Un envío necesita al menos un código postal o rango de cobertura.");
  const values = { ...parsed.data, postalCodes: parsed.data.kind === "pickup" ? [] : rules, isActive: formData.get("isActive") === "on", updatedAt: new Date() };
  if (id) await db.update(shippingMethods).set(values).where(eq(shippingMethods.id, id));
  else await db.insert(shippingMethods).values(values);
  await audit(user.id, "shipping.save", "shipping_method", id, values);
  redirectOk(back, "Método de entrega guardado.");
}
