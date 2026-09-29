"use server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { banners, faqs, pages } from "@/lib/db/schema";
import { requirePermission } from "@/lib/auth/guards";
import { audit } from "@/lib/audit";
import { redirectError, redirectOk, zodMessage } from "@/lib/admin/flash";
import { getStoreSettings, HOME_SECTIONS, saveStoreSettings, storeSettingsSchema, type HomeSection } from "@/lib/content/settings";
import { plainTextToHtml, sanitizeRichText } from "@/lib/content/sanitize";
import { slugify } from "@/lib/slug";

const back = "/admin/contenido";

export async function saveHomeAction(formData: FormData) {
  const user = await requirePermission("content:write");
  const current = await getStoreSettings();
  const order = HOME_SECTIONS.map((s) => ({ s, on: formData.get(`on_${s}`) === "on", pos: Number(formData.get(`pos_${s}`) ?? 99) }))
    .filter((x) => x.on)
    .sort((a, b) => a.pos - b.pos)
    .map((x) => x.s as HomeSection);
  const next = storeSettingsSchema.safeParse({
    ...current,
    homeSections: order,
    announcementEnabled: formData.get("announcementEnabled") === "on",
    announcementText: String(formData.get("announcementText") ?? "").slice(0, 160),
    featuredThemeId: String(formData.get("featuredThemeId") ?? "") || null,
    personalizationBlurb: String(formData.get("personalizationBlurb") ?? ""),
    howToBuy: [0, 1, 2].map((i) => ({ title: String(formData.get(`how_t_${i}`) ?? ""), text: String(formData.get(`how_d_${i}`) ?? "") })),
  });
  if (!next.success) redirectError(back, zodMessage(next.error.issues));
  await saveStoreSettings(next.data, user.id);
  await audit(user.id, "content.home", "settings", "store", { homeSections: order });
  redirectOk(back, "Inicio actualizado.");
}

export async function saveBannerAction(formData: FormData) {
  const user = await requirePermission("content:write");
  const id = String(formData.get("id") ?? "") || null;
  const href = String(formData.get("ctaHref") ?? "/productos").trim();
  const parsed = z
    .object({
      title: z.string().trim().min(2).max(80),
      subtitle: z.string().max(160),
      ctaLabel: z.string().trim().min(2).max(40),
      ctaHref: z.string().regex(/^\/[a-zA-Z0-9\-/_?=&.]*$/, "El enlace debe ser una ruta interna que empiece con /"),
      sort: z.number().int(),
    })
    .safeParse({ title: formData.get("title"), subtitle: String(formData.get("subtitle") ?? ""), ctaLabel: formData.get("ctaLabel"), ctaHref: href, sort: Number(formData.get("sort") ?? 0) || 0 });
  if (!parsed.success) redirectError(back, zodMessage(parsed.error.issues));
  const values = { ...parsed.data, isActive: formData.get("isActive") === "on" };
  if (id) await db.update(banners).set(values).where(eq(banners.id, id));
  else await db.insert(banners).values(values);
  await audit(user.id, "content.banner", "banner", id, values);
  redirectOk(back, "Banner guardado.");
}

export async function deleteBannerAction(formData: FormData) {
  const user = await requirePermission("content:write");
  const id = z.string().uuid().parse(formData.get("id"));
  await db.delete(banners).where(eq(banners.id, id));
  await audit(user.id, "content.banner.delete", "banner", id);
  redirectOk(back, "Banner eliminado.");
}

export async function saveFaqAction(formData: FormData) {
  const user = await requirePermission("content:write");
  const id = String(formData.get("id") ?? "") || null;
  const question = String(formData.get("question") ?? "").trim();
  const answer = String(formData.get("answer") ?? "").trim();
  if (question.length < 3 || answer.length < 3) redirectError(back, "Completá pregunta y respuesta.");
  const values = { question: question.slice(0, 200), answerHtml: sanitizeRichText(plainTextToHtml(answer.slice(0, 3000))), sort: Number(formData.get("sort") ?? 0) || 0, isActive: formData.get("isActive") === "on" };
  if (id) await db.update(faqs).set(values).where(eq(faqs.id, id));
  else await db.insert(faqs).values(values);
  await audit(user.id, "content.faq", "faq", id);
  redirectOk(back, "Pregunta guardada.");
}

export async function deleteFaqAction(formData: FormData) {
  await requirePermission("content:write");
  await db.delete(faqs).where(eq(faqs.id, z.string().uuid().parse(formData.get("id"))));
  redirectOk(back, "Pregunta eliminada.");
}

export async function savePageAction(formData: FormData) {
  const user = await requirePermission("content:write");
  const slug = slugify(String(formData.get("slug") ?? ""));
  const title = String(formData.get("title") ?? "").trim().slice(0, 100);
  if (!slug || title.length < 2) redirectError(back, "La página necesita título y slug.");
  const body = sanitizeRichText(plainTextToHtml(String(formData.get("body") ?? "").slice(0, 30000)));
  const values = { title, bodyHtml: body, isPending: formData.get("isPending") === "on", showInFooter: formData.get("showInFooter") === "on", updatedAt: new Date() };
  await db.insert(pages).values({ slug, ...values }).onConflictDoUpdate({ target: pages.slug, set: values });
  await audit(user.id, "content.page", "page", slug);
  redirectOk(back, `Página “${title}” guardada.`);
}
