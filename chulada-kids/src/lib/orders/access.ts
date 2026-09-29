import "server-only";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { orders } from "../db/schema";
import { hmac, safeEqual, sha256 } from "../crypto";
import { env } from "../env";
import { getCurrentUser } from "../auth/session";
import { can } from "../auth/permissions";

/** Token de acceso de invitado: HMAC del id (256 bits, no secuencial). En la base solo se guarda su SHA-256. */
export function orderAccessToken(orderId: string): string {
  return hmac(`order-access:${orderId}`);
}

export function orderAccessHash(orderId: string): string {
  return sha256(orderAccessToken(orderId));
}

export function orderLink(orderId: string): string {
  return `${env.appUrl}/pedido/${orderId}?t=${orderAccessToken(orderId)}`;
}

/** Autoriza ver/pagar un pedido: token válido, dueño con sesión, o personal con permiso. */
export async function authorizeOrderAccess(orderId: string, token: string | null | undefined) {
  if (!/^[0-9a-f-]{36}$/.test(orderId)) return null;
  const [order] = await db.select().from(orders).where(eq(orders.id, orderId));
  if (!order) return null;
  if (token && safeEqual(sha256(token), order.accessTokenHash)) return { order, via: "token" as const };
  const user = await getCurrentUser();
  if (user && order.userId === user.id) return { order, via: "owner" as const };
  if (user && can(user.role, "orders:read")) return { order, via: "staff" as const };
  return null;
}

export function orderNumber(n: number): string {
  return `CK-${String(n).padStart(6, "0")}`;
}
