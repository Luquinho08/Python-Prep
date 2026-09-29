"use server";
import { requirePermission } from "@/lib/auth/guards";
import { audit } from "@/lib/audit";
import { redirectError, redirectOk, zodMessage } from "@/lib/admin/flash";
import { getStoreSettings, saveStoreSettings, storeSettingsSchema } from "@/lib/content/settings";

export async function saveSettingsAction(formData: FormData) {
  const user = await requirePermission("settings:write");
  const current = await getStoreSettings();
  const str = (k: string) => String(formData.get(k) ?? "").trim();
  const url = (k: string) => {
    const v = str(k);
    return v && !/^https:\/\//.test(v) ? "INVALID" : v;
  };
  const next = storeSettingsSchema.safeParse({
    ...current,
    storeName: str("storeName"),
    tagline: str("tagline"),
    contactEmail: str("contactEmail"),
    contactPhone: str("contactPhone"),
    whatsapp: str("whatsapp"),
    instagram: url("instagram"),
    facebook: url("facebook"),
    tiktok: url("tiktok"),
    pickupAddress: str("pickupAddress"),
    businessHours: str("businessHours"),
    legalName: str("legalName"),
    taxId: str("taxId"),
    checkoutEnabled: formData.get("checkoutEnabled") === "on",
    noindexSite: formData.get("noindexSite") === "on",
  });
  if (!next.success) redirectError("/admin/configuracion", zodMessage(next.error.issues));
  if ([next.data.instagram, next.data.facebook, next.data.tiktok].includes("INVALID")) redirectError("/admin/configuracion", "Las redes deben ser enlaces https://");
  if (next.data.contactEmail && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(next.data.contactEmail)) redirectError("/admin/configuracion", "Email de contacto inválido.");
  await saveStoreSettings(next.data, user.id);
  await audit(user.id, "settings.save", "settings", "store", { checkoutEnabled: next.data.checkoutEnabled });
  redirectOk("/admin/configuracion", "Configuración guardada.");
}
