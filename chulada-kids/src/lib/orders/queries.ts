import "server-only";
import { asc, desc, eq } from "drizzle-orm";
import { db } from "../db";
import { designProofs, incidents, orderEvents, orderLines, orderNotes, orders, users } from "../db/schema";
import { signResource } from "../crypto";

export async function getOrderDetail(orderId: string, opts: { forStaff: boolean }) {
  const [order] = await db.select().from(orders).where(eq(orders.id, orderId));
  if (!order) return null;
  const [lines, events, notes, proofs, incs] = await Promise.all([
    db.select().from(orderLines).where(eq(orderLines.orderId, orderId)),
    db
      .select({ e: orderEvents, actor: users.name })
      .from(orderEvents)
      .leftJoin(users, eq(users.id, orderEvents.actorUserId))
      .where(eq(orderEvents.orderId, orderId))
      .orderBy(asc(orderEvents.createdAt)),
    db.select().from(orderNotes).where(eq(orderNotes.orderId, orderId)).orderBy(desc(orderNotes.createdAt)),
    db.select().from(designProofs).where(eq(designProofs.orderId, orderId)).orderBy(desc(designProofs.version)),
    opts.forStaff ? db.select().from(incidents).where(eq(incidents.orderId, orderId)).orderBy(desc(incidents.createdAt)) : Promise.resolve([]),
  ]);
  // Enlaces firmados de 1 h para archivos privados (referencias y pruebas de diseño).
  const privateLink = (mediaId: string) => `/api/private-media/${mediaId}?sig=${encodeURIComponent(signResource(`private:${mediaId}`, 3600))}`;
  return {
    order,
    lines: lines.map((l) => ({ ...l, personalization: l.personalization.map((p) => ({ ...p, href: p.mediaId ? privateLink(p.mediaId) : null })) })),
    // El cliente solo ve eventos de estado; nunca notas internas ni detalles técnicos de pago.
    events: opts.forStaff
      ? events
      : events.filter((x) => ["created", "payment_status", "fulfillment_status", "proof_sent", "proof_decision", "cancelled", "refund"].includes(x.e.type)),
    notes: opts.forStaff ? notes : notes.filter((n) => n.visibility === "customer"),
    proofs: proofs.map((p) => ({ ...p, href: p.mediaId ? privateLink(p.mediaId) : null })),
    incidents: incs,
  };
}
