import { eq, max } from "drizzle-orm";
import { db } from "@/lib/db";
import { productImages, products } from "@/lib/db/schema";
import { getCurrentUser } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { audit } from "@/lib/audit";
import { sameOrigin } from "@/lib/http";
import { IMAGE_MIME, saveUpload, UploadError } from "@/lib/storage";

const MAX_MB = 10;

/** Subida múltiple de imágenes de catálogo (públicas). Formulario HTML clásico: redirige con mensaje. */
export async function POST(req: Request, ctx: RouteContext<"/api/admin/products/[id]/images">) {
  const { id } = await ctx.params;
  const back = (q: string) => Response.redirect(new URL(`/admin/productos/${id}?${q}`, req.url), 303);
  if (!sameOrigin(req)) return new Response("Origen no permitido", { status: 403 });
  const user = await getCurrentUser();
  if (!user || !can(user.role, "catalog:write")) return new Response("No autorizado", { status: 403 });
  const [p] = await db.select({ id: products.id, name: products.name }).from(products).where(eq(products.id, id));
  if (!p) return new Response("No encontrado", { status: 404 });

  const form = await req.formData();
  const files = form.getAll("files").filter((f): f is File => f instanceof File && f.size > 0).slice(0, 12);
  if (files.length === 0) return back(`error=${encodeURIComponent("Elegí al menos una imagen.")}`);
  const [{ m }] = await db.select({ m: max(productImages.sort) }).from(productImages).where(eq(productImages.productId, id));
  let sort = (m ?? -1) + 1;
  const errors: string[] = [];
  let ok = 0;
  for (const f of files) {
    try {
      const saved = await saveUpload({
        data: Buffer.from(await f.arrayBuffer()),
        visibility: "public",
        allowed: IMAGE_MIME,
        maxBytes: MAX_MB * 1024 * 1024,
        originalName: f.name,
        alt: p.name,
        createdBy: user.id,
      });
      await db.insert(productImages).values({ productId: id, mediaId: saved.id, alt: p.name, sort: sort++ });
      ok++;
    } catch (e) {
      if (e instanceof UploadError) errors.push(`${f.name}: ${e.message}`);
      else throw e;
    }
  }
  await audit(user.id, "image.upload", "product", id, { count: ok });
  if (errors.length) return back(`error=${encodeURIComponent(`${ok} subida(s). Rechazadas: ${errors.join(" · ")}`)}`);
  return back(`ok=${encodeURIComponent(`${ok} imagen(es) subida(s). Revisá el texto alternativo.`)}`);
}
