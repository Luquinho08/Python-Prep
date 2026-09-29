"use server";
import { and, desc, eq } from "drizzle-orm";
import { refresh } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { designProofs, orderEvents, orders } from "@/lib/db/schema";
import { authorizeOrderAccess, orderNumber } from "@/lib/orders/access";
import { enqueueEmail } from "@/lib/email/outbox";
import { getStoreSettings } from "@/lib/content/settings";
import { env } from "@/lib/env";

/** El comprador aprueba o pide cambios sobre la última versión del diseño. */
export async function decideProofAction(formData: FormData) {
  const orderId = z.string().uuid().parse(formData.get("orderId"));
  const access = await authorizeOrderAccess(orderId, String(formData.get("t") ?? ""));
  if (!access || access.via === "staff") throw new Error("No autorizado");
  const decision = formData.get("decision") === "approve" ? "approved" : "changes_requested";
  const comment = String(formData.get("comment") ?? "").trim().slice(0, 1000);
  const [latest] = await db.select().from(designProofs).where(eq(designProofs.orderId, orderId)).orderBy(desc(designProofs.version)).limit(1);
  if (!latest || latest.status !== "pending") throw new Error("No hay una prueba pendiente");
  await db.transaction(async (tx) => {
    await tx
      .update(designProofs)
      .set({ status: decision, customerComment: comment || null, decidedAt: new Date() })
      .where(and(eq(designProofs.id, latest.id), eq(designProofs.status, "pending")));
    await tx.insert(orderEvents).values({
      orderId,
      type: "proof_decision",
      toValue: decision,
      message: `Versión ${latest.version}: ${decision === "approved" ? "aprobada" : "cambios solicitados"}${comment ? ` — ${comment}` : ""}`,
      actorLabel: "cliente",
    });
    if (decision === "changes_requested") {
      await tx
        .update(orders)
        .set({ fulfillmentStatus: "awaiting_data", updatedAt: new Date() })
        .where(and(eq(orders.id, orderId), eq(orders.fulfillmentStatus, "awaiting_approval")));
    }
  });
  const s = await getStoreSettings();
  await enqueueEmail({
    dedupeKey: `proof-decision:${latest.id}`,
    to: process.env.ADMIN_NOTIFICATION_EMAIL || s.contactEmail,
    subject: `Diseño ${decision === "approved" ? "aprobado" : "con cambios"} — ${orderNumber(access.order.number)}`,
    text: `${access.order.customerName} ${decision === "approved" ? "aprobó" : "pidió cambios en"} la versión ${latest.version}.\n${comment}\n${env.appUrl}/admin/pedidos/${orderId}`,
  });
  refresh();
}
