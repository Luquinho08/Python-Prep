import "server-only";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { cache } from "react";
import { db } from "../db";
import { settings } from "../db/schema";

export const HOME_SECTIONS = ["announcement", "hero", "categories", "featured", "promotions", "collection", "how"] as const;
export type HomeSection = (typeof HOME_SECTIONS)[number];

export const HOME_SECTION_LABELS: Record<HomeSection, string> = {
  announcement: "Franja informativa",
  hero: "Banner principal",
  categories: "Categorías",
  featured: "Destacados",
  promotions: "Promociones vigentes",
  collection: "Temática elegida y personalización",
  how: "Cómo comprar",
};

export const storeSettingsSchema = z.object({
  storeName: z.string().min(1).max(80).default("Chulada Kids"),
  tagline: z.string().max(140).default("Papelería creativa y personalizada"),
  contactEmail: z.string().max(120).default(""),
  contactPhone: z.string().max(40).default(""),
  whatsapp: z.string().max(40).default(""),
  instagram: z.string().max(120).default(""),
  facebook: z.string().max(120).default(""),
  tiktok: z.string().max(120).default(""),
  pickupAddress: z.string().max(200).default(""),
  businessHours: z.string().max(200).default(""),
  legalName: z.string().max(160).default(""),
  taxId: z.string().max(40).default(""),
  announcementEnabled: z.boolean().default(false),
  announcementText: z.string().max(160).default(""),
  logoMediaId: z.string().uuid().nullable().default(null),
  homeSections: z.array(z.enum(HOME_SECTIONS)).default([...HOME_SECTIONS]),
  featuredThemeId: z.string().uuid().nullable().default(null),
  personalizationBlurb: z
    .string()
    .max(600)
    .default("Elegí el producto, completá los datos de personalización y revisamos tu pedido antes de producirlo."),
  howToBuy: z
    .array(z.object({ title: z.string().max(60), text: z.string().max(240) }))
    .length(3)
    .default([
      { title: "Elegí y personalizá", text: "Buscá el producto, elegí la variante y completá los datos de personalización." },
      { title: "Pagá seguro", text: "Pagás con tarjeta o con tu cuenta de Mercado Pago. Confirmamos el pago antes de producir." },
      { title: "Recibí o retirá", text: "Te avisamos cuando tu pedido está listo para envío o retiro." },
    ]),
  /** La compra se habilita solo cuando el propietario completa datos comerciales y catálogo. */
  checkoutEnabled: z.boolean().default(false),
  noindexSite: z.boolean().default(true),
});

export type StoreSettings = z.infer<typeof storeSettingsSchema>;

export const getStoreSettings = cache(async (): Promise<StoreSettings> => {
  const [row] = await db.select().from(settings).where(eq(settings.key, "store"));
  const parsed = storeSettingsSchema.safeParse(row?.value ?? {});
  return parsed.success ? parsed.data : storeSettingsSchema.parse({});
});

export async function saveStoreSettings(value: StoreSettings, userId: string | null) {
  const parsed = storeSettingsSchema.parse(value);
  await db
    .insert(settings)
    .values({ key: "store", value: parsed, updatedBy: userId })
    .onConflictDoUpdate({ target: settings.key, set: { value: parsed, updatedAt: new Date(), updatedBy: userId } });
}

/** Condiciones mínimas para cobrar. Si falla alguna, se muestra "configuración pendiente". */
export function checkoutReadinessProblems(s: StoreSettings): string[] {
  const problems: string[] = [];
  if (!s.checkoutEnabled) problems.push("El propietario todavía no habilitó la compra en Configuración.");
  if (!s.contactEmail) problems.push("Falta el email de contacto del comercio.");
  return problems;
}

export function whatsappLink(number: string): string | null {
  const digits = number.replace(/\D/g, "");
  return digits.length >= 8 ? `https://wa.me/${digits}` : null;
}
