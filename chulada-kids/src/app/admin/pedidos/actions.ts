"use server";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { couponRedemptions, designProofs, incidents, orderEvents, orderLines, orderNotes, orders, paymentAttempts } from "@/lib/db/schema";
import { requirePermission } from "@/lib/auth/guards";
import { audit } from "@/lib/audit";
import { redirectError, redirectOk } from "@/lib/admin/flash";
import { enqueueEmail } from "@/lib/email/outbox";
import { orderStatusEmail } from "@/lib/email/templates";
import { orderLink, orderNumber } from "@/lib/orders/access";
import { FULFILLMENT_LABEL, transitionProblem, type FulfillmentStatus } from "@/lib/orders/status";
import { releaseReservations, restockOrder } from "@/lib/orders/reservations";
import { refreshOrderPayment, refundOrderPayment } from "@/lib/payments/service";
import { getGateway } from "@/lib/payments/connection";
import { parsePesosInput } from "@/lib/money";
import { IN_FLIGHT } from "@/lib/payments/status";

const uuid = z.string().uuid();
const back = (id: string) => `/admin/pedidos/${id}`;

export async function changeFulfillmentAction(formData: FormData) {
  const user = await requirePermission("orders:write");
  const id = uuid.parse(formData.get("orderId"));
  const to = String(formData.get("to")) as FulfillmentStatus;
  const notify = formData.get("notify") === "on";
  const [o] = await db.select().from(orders).where(eq(orders.id, id));
  if (!o) redirectError("/admin/pedidos", "Pedido inexistente.");
  const lines = await db.select().from(orderLines).where(eq(orderLines.orderId, id));
  const approved = await db.select().from(designProofs).where(and(eq(designProofs.orderId, id), eq(designProofs.status, "approved")));
  const problem = transitionProblem({
    from: o.fulfillmentStatus as FulfillmentStatus,
    to,
    paymentStatus: o.paymentStatus,
    requiresApproval: lines.some((l) => l.requiresDesignApproval),
    hasApprovedProof: approved.length > 0,
    shippingKind: o.shipping.kind,
  });
  if (problem) redirectError(back(id), problem);
  // Actualización condicionada al estado leído: evita pisar un cambio concurrente.
  const updated = await db.update(orders).set({ fulfillmentStatus: to, updatedAt: new Date() }).where(and(eq(orders.id, id), eq(orders.fulfillmentStatus, o.fulfillmentStatus))).returning();
  if (!updated.length) redirectError(back(id), "El pedido cambió mientras lo editabas. Recargá la página.");
  await db.insert(orderEvents).values({ orderId: id, type: "fulfillment_status", fromValue: o.fulfillmentStatus, toValue: to, actorUserId: user.id, actorLabel: user.name || user.email });
  if (notify) {
    const mail = orderStatusEmail({ number: orderNumber(o.number), name: o.customerName, statusLabel: FULFILLMENT_LABEL[to], link: orderLink(o.id) });
    await enqueueEmail({ dedupeKey: `status:${id}:${to}`, to: o.email, ...mail });
  }
  await audit(user.id, "order.fulfillment", "order", id, { from: o.fulfillmentStatus, to });
  redirectOk(back(id), `Estado actualizado a “${FULFILLMENT_LABEL[to]}”${notify ? " (aviso encolado al cliente)" : ""}.`);
}

export async function addNoteAction(formData: FormData) {
  const user = await requirePermission("orders:write");
  const id = uuid.parse(formData.get("orderId"));
  const visibility = formData.get("visibility") === "customer" ? "customer" : "internal";
  const body = String(formData.get("body") ?? "").trim().slice(0, 3000);
  if (body.length < 2) redirectError(back(id), "Escribí la nota.");
  const [n] = await db.insert(orderNotes).values({ orderId: id, visibility, body, authorUserId: user.id }).returning();
  if (visibility === "customer") {
    const [o] = await db.select().from(orders).where(eq(orders.id, id));
    await enqueueEmail({ dedupeKey: `note:${n.id}`, to: o.email, subject: `Novedades de tu pedido ${orderNumber(o.number)}`, text: `${body}\n\nSeguimiento: ${orderLink(o.id)}` });
  }
  await audit(user.id, "order.note", "order", id, { visibility });
  redirectOk(back(id), visibility === "customer" ? "Mensaje enviado al cliente (visible en su pedido)." : "Nota interna guardada (el cliente no la ve).");
}

export async function resolveIncidentAction(formData: FormData) {
  const user = await requirePermission("orders:refund");
  const id = uuid.parse(formData.get("orderId"));
  const incidentId = uuid.parse(formData.get("incidentId"));
  await db.update(incidents).set({ status: "resolved", resolvedBy: user.id, resolvedAt: new Date() }).where(and(eq(incidents.id, incidentId), eq(incidents.orderId, id)));
  await db.insert(orderEvents).values({ orderId: id, type: "incident_resolved", message: String(formData.get("note") ?? "").slice(0, 500), actorUserId: user.id });
  await audit(user.id, "incident.resolve", "incident", incidentId);
  redirectOk(back(id), "Incidencia marcada como resuelta.");
}

export async function reconcileNowAction(formData: FormData) {
  await requirePermission("orders:read");
  const id = uuid.parse(formData.get("orderId"));
  await refreshOrderPayment(id);
  redirectOk(back(id), "Estado consultado a Mercado Pago.");
}

/** Reembolso (solo propietario, con confirmación). El estado cambia solo cuando el proveedor lo confirma. */
export async function refundAction(formData: FormData) {
  const user = await requirePermission("orders:refund");
  const id = uuid.parse(formData.get("orderId"));
  if (formData.get("confirm") !== "on") redirectError(back(id), "Confirmá el reembolso marcando la casilla.");
  const raw = String(formData.get("amount") ?? "").trim();
  const amount = raw ? parsePesosInput(raw) : null;
  if (raw && amount === null) redirectError(back(id), "Monto inválido.");
  try {
    await refundOrderPayment(id, amount, user.id);
  } catch (e) {
    await db.insert(orderEvents).values({ orderId: id, type: "refund_failed", message: (e as Error).message.slice(0, 300), actorUserId: user.id });
    redirectError(back(id), `El reembolso no se completó: ${(e as Error).message}`);
  }
  await audit(user.id, "order.refund", "order", id, { amountCents: amount });
  redirectOk(back(id), "Reembolso solicitado y sincronizado con el proveedor.");
}

/** Cancelación (solo propietario). Si está pagado, primero reembolsa en el proveedor; no alcanza con cambiar una etiqueta. */
export async function cancelOrderAction(formData: FormData) {
  const user = await requirePermission("orders:refund");
  const id = uuid.parse(formData.get("orderId"));
  if (formData.get("confirm") !== "on") redirectError(back(id), "Confirmá la cancelación marcando la casilla.");
  const restock = formData.get("restock") === "on";
  const reason = String(formData.get("reason") ?? "").trim().slice(0, 500);
  const [o] = await db.select().from(orders).where(eq(orders.id, id));
  if (!o || o.fulfillmentStatus === "cancelled") redirectError(back(id), "El pedido ya está cancelado.");

  const inflight = await db.select().from(paymentAttempts).where(and(eq(paymentAttempts.orderId, id), inArray(paymentAttempts.status, IN_FLIGHT)));
  if (inflight.length) {
    const gw = await getGateway();
    for (const a of inflight) if (a.method === "card" && a.providerRef && gw) await gw.cancelOrder(a.providerRef).catch(() => null);
    await refreshOrderPayment(id);
  }
  const [fresh] = await db.select().from(orders).where(eq(orders.id, id));
  if (["approved", "partially_refunded"].includes(fresh.paymentStatus)) {
    try {
      await refundOrderPayment(id, null, user.id);
    } catch (e) {
      redirectError(back(id), `No se canceló: el reembolso falló (${(e as Error).message}). El pedido sigue activo.`);
    }
    const [after] = await db.select().from(orders).where(eq(orders.id, id));
    if (after.paymentStatus !== "refunded") redirectError(back(id), "El proveedor todavía no confirmó el reembolso total. Reintentá en unos minutos; el pedido sigue activo.");
  }
  await db.transaction(async (tx) => {
    await releaseReservations(tx, id);
    if (restock) await restockOrder(tx, id);
    await tx.update(couponRedemptions).set({ status: "released", updatedAt: new Date() }).where(and(eq(couponRedemptions.orderId, id), eq(couponRedemptions.status, "reserved")));
    await tx.update(orders).set({ fulfillmentStatus: "cancelled", cancelledAt: new Date(), updatedAt: new Date() }).where(eq(orders.id, id));
    await tx.insert(orderEvents).values({ orderId: id, type: "cancelled", fromValue: o.fulfillmentStatus, toValue: "cancelled", message: reason || "Cancelado por el propietario.", actorUserId: user.id });
  });
  const mail = orderStatusEmail({ number: orderNumber(o.number), name: o.customerName, statusLabel: "Cancelado", message: reason, link: orderLink(o.id) });
  await enqueueEmail({ dedupeKey: `cancel:${id}`, to: o.email, ...mail });
  await audit(user.id, "order.cancel", "order", id, { restock, reason });
  redirectOk(back(id), "Pedido cancelado.");
}
