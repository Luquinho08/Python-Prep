import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { media } from "@/lib/db/schema";
import { getCurrentUser } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { verifyResourceSignature } from "@/lib/crypto";
import { readStored } from "@/lib/storage";

/**
 * Archivos privados (referencias de clientes, pruebas de diseño).
 * Acceso: personal con permiso de pedidos, o enlace firmado temporal emitido al dueño del pedido.
 */
export async function GET(req: Request, ctx: RouteContext<"/api/private-media/[id]">) {
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/.test(id)) return new Response("No encontrado", { status: 404 });
  const sig = new URL(req.url).searchParams.get("sig");
  const user = await getCurrentUser();
  const allowed = can(user?.role, "orders:read") || verifyResourceSignature(`private:${id}`, sig);
  if (!allowed) return new Response("No autorizado", { status: 403 });
  const [m] = await db.select().from(media).where(eq(media.id, id));
  if (!m || m.visibility !== "private") return new Response("No encontrado", { status: 404 });
  const data = await readStored(m.storageKey);
  const isPdf = m.mime === "application/pdf";
  return new Response(new Uint8Array(data), {
    headers: {
      "Content-Type": m.mime,
      "Content-Disposition": `${isPdf ? "attachment" : "inline"}; filename="${isPdf ? "referencia.pdf" : "referencia.webp"}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; img-src 'self'; sandbox",
    },
  });
}
