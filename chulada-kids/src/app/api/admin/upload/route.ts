import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { banners, categories, themes } from "@/lib/db/schema";
import { getCurrentUser } from "@/lib/auth/session";
import { can, type Permission } from "@/lib/auth/permissions";
import { audit } from "@/lib/audit";
import { sameOrigin } from "@/lib/http";
import { getStoreSettings, saveStoreSettings } from "@/lib/content/settings";
import { IMAGE_MIME, saveUpload, UploadError } from "@/lib/storage";

/** Subida de una imagen para banner, logo, categoría o temática. Formulario HTML: redirige con mensaje. */
export async function POST(req: Request) {
  if (!sameOrigin(req)) return new Response("Origen no permitido", { status: 403 });
  const form = await req.formData();
  const target = String(form.get("target") ?? "");
  const id = String(form.get("id") ?? "");
  const backPath = String(form.get("back") ?? "/admin");
  const back = (q: string) => Response.redirect(new URL(`${backPath.startsWith("/admin") ? backPath : "/admin"}?${q}`, req.url), 303);
  const perm: Record<string, Permission> = { banner: "content:write", logo: "settings:write", category: "catalog:write", theme: "catalog:write" };
  const user = await getCurrentUser();
  if (!perm[target] || !user || !can(user.role, perm[target])) return new Response("No autorizado", { status: 403 });
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) return back(`error=${encodeURIComponent("Elegí una imagen.")}`);
  try {
    const m = await saveUpload({
      data: Buffer.from(await file.arrayBuffer()),
      visibility: "public",
      allowed: IMAGE_MIME,
      maxBytes: 10 * 1024 * 1024,
      originalName: file.name,
      alt: String(form.get("alt") ?? "").slice(0, 200),
      createdBy: user.id,
    });
    if (target === "banner") await db.update(banners).set({ imageId: m.id }).where(eq(banners.id, id));
    if (target === "category") await db.update(categories).set({ imageId: m.id }).where(eq(categories.id, id));
    if (target === "theme") await db.update(themes).set({ imageId: m.id }).where(eq(themes.id, id));
    if (target === "logo") await saveStoreSettings({ ...(await getStoreSettings()), logoMediaId: m.id }, user.id);
    await audit(user.id, "media.upload", target, id || null, { mediaId: m.id });
    return back(`ok=${encodeURIComponent("Imagen actualizada.")}`);
  } catch (e) {
    if (e instanceof UploadError) return back(`error=${encodeURIComponent(e.message)}`);
    throw e;
  }
}
