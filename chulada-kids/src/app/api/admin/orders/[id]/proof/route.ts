import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { designProofs, orderEvents, orders } from "@/lib/db/schema";
import { getCurrentUser } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { audit } from "@/lib/audit";
import { sameOrigin } from "@/lib/http";
import { enqueueEmail } from "@/lib/email/outbox";
import { orderLink, orderNumber } from "@/lib/orders/access";
import { REFERENCE_MIME, saveUpload, UploadError } from "@/lib/storage";

/** Sube una nueva versión de la prueba de diseño (archivo privado) y la envía al cliente para aprobar. */
export async function POST(req: Request, ctx: RouteContext<"/api/admin/orders/[id]/proof">) {
  const { id } = await ctx.params;
  const back = (q: string) => Response.redirect(new URL(`/admin/pedidos/${id}?${q}`, req.url), 303);
  if (!sameOrigin(req)) return new Response("Origen no permitido", { status: 403 });
  const user = await getCurrentUser();
  if (!user || !can(user.role, "orders:write")) return new Response("No autorizado", { status: 403 });
  const [o] = await db.select().from(orders).where(eq(orders.id, id));
  if (!o) return new Response("No encontrado", { status: 404 });
  if (!["approved", "partially_refunded"].includes(o.paymentStatus)) return back(`error=${encodeURIComponent("El pedido no está pagado.")}`);
  const form = await req.formData();
  const file = form.get("file");
  const note = String(form.get("note") ?? "").slice(0, 1000);
  if (!(file instanceof File) || file.size === 0) return back(`error=${encodeURIComponent("Elegí el archivo de la prueba.")}`);
  let mediaId: string;
  try {
    const m = await saveUpload({ data: Buffer.from(await file.arrayBuffer()), visibility: "private", allowed: REFERENCE_MIME, maxBytes: 10 * 1024 * 1024, originalName: file.name, createdBy: user.id });
    mediaId = m.id;
  } catch (e) {
    if (e instanceof UploadError) return back(`error=${encodeURIComponent(e.message)}`);
    throw e;
  }
  const [last] = await db.select().from(designProofs).where(eq(designProofs.orderId, id)).orderBy(desc(designProofs.version)).limit(1);
  const version = (last?.version ?? 0) + 1;
  await db.transaction(async (tx) => {
    // Las versiones anteriores pendientes quedan reemplazadas por la nueva.
    await tx.update(designProofs).set({ status: "changes_requested", customerComment: "Reemplazada por una versión nueva" }).where(and(eq(designProofs.orderId, id), eq(designProofs.status, "pending")));
    await tx.insert(designProofs).values({ orderId: id, version, mediaId, note, createdBy: user.id });
    await tx.update(orders).set({ fulfillmentStatus: "awaiting_approval", updatedAt: new Date() }).where(and(eq(orders.id, id), inArray(orders.fulfillmentStatus, ["received", "awaiting_data", "awaiting_approval"])));
    await tx.insert(orderEvents).values({ orderId: id, type: "proof_sent", toValue: String(version), message: `Prueba de diseño v${version} enviada para aprobación.`, actorUserId: user.id });
  });
  await enqueueEmail({
    dedupeKey: `proof:${id}:${version}`,
    to: o.email,
    subject: `Tu diseño está listo para revisar — ${orderNumber(o.number)}`,
    text: `Hola ${o.customerName}. Subimos la versión ${version} del diseño de tu pedido. Revisala y aprobala (o pedí cambios) acá:\n${orderLink(o.id)}\n\n${note}`,
  });
  await audit(user.id, "order.proof", "order", id, { version });
  return back(`ok=${encodeURIComponent(`Prueba v${version} enviada al cliente.`)}`);
}
