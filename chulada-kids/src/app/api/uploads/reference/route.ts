import { getOrCreateCart, uploadClaim } from "@/lib/cart/service";
import { signResource } from "@/lib/crypto";
import { jsonError, jsonOk, sameOrigin } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";
import { clientIp } from "@/lib/request";
import { REFERENCE_MIME, saveUpload, UploadError } from "@/lib/storage";

const MAX_MB = 8;

/** Archivo de referencia de personalización (privado). Devuelve un token ligado al carrito. */
export async function POST(req: Request) {
  if (!sameOrigin(req)) return jsonError("Origen no permitido.", 403);
  if (!(await rateLimit(`upload-ref:${await clientIp()}`, 20, 600))) return jsonError("Demasiadas subidas. Probá más tarde.", 429);
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return jsonError("Elegí un archivo.");
  if (file.size > MAX_MB * 1024 * 1024) return jsonError(`El archivo supera ${MAX_MB} MB.`);
  const cart = await getOrCreateCart();
  try {
    const m = await saveUpload({
      data: Buffer.from(await file.arrayBuffer()),
      visibility: "private",
      allowed: REFERENCE_MIME,
      maxBytes: MAX_MB * 1024 * 1024,
      originalName: file.name.replace(/[^\w.\- áéíóúñÁÉÍÓÚÑ]/g, "_"),
    });
    return jsonOk({ mediaId: m.id, token: signResource(uploadClaim(m.id, cart.id), 6 * 3600), name: m.originalName });
  } catch (e) {
    if (e instanceof UploadError) return jsonError(e.message);
    throw e;
  }
}
