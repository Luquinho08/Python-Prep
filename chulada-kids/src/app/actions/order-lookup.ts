"use server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { orders } from "@/lib/db/schema";
import { enqueueEmail } from "@/lib/email/outbox";
import { orderLink, orderNumber } from "@/lib/orders/access";
import { rateLimit } from "@/lib/rate-limit";
import { clientIp } from "@/lib/request";

export type LookupState = { ok: boolean; message: string } | null;

/**
 * Recuperar el enlace de un pedido de invitado: se envía SOLO al email del pedido.
 * La respuesta es siempre la misma (no revela si el pedido existe).
 */
export async function orderLookupAction(_prev: LookupState, formData: FormData): Promise<LookupState> {
  const email = z.string().trim().toLowerCase().email().safeParse(formData.get("email"));
  const num = Number(String(formData.get("number") ?? "").replace(/\D/g, ""));
  const generic = { ok: true, message: "Si los datos coinciden con un pedido, te enviamos el enlace de seguimiento a ese email." };
  if (!email.success || !num) return { ok: false, message: "Ingresá el email de la compra y el número de pedido (CK-000123)." };
  if (!(await rateLimit(`lookup:${await clientIp()}`, 10, 3600))) return generic;
  const [o] = await db.select().from(orders).where(and(eq(orders.number, num), eq(orders.email, email.data)));
  if (o) {
    await enqueueEmail({
      dedupeKey: `lookup:${o.id}:${new Date().toISOString().slice(0, 13)}`,
      to: o.email,
      subject: `Enlace de tu pedido ${orderNumber(o.number)}`,
      text: `Este es el enlace personal de tu pedido ${orderNumber(o.number)} (no lo compartas):\n${orderLink(o.id)}`,
    });
  }
  return generic;
}
