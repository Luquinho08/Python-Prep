import "server-only";
import { and, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { db } from "./db";
import { couponRedemptions, orderEvents, orders, paymentAttempts, paymentConnections } from "./db/schema";
import { releaseReservations } from "./orders/reservations";
import { reconcileAttempt } from "./payments/service";
import { IN_FLIGHT } from "./payments/status";
import { retryFailedWebhooks } from "./payments/webhooks";
import { processEmailOutbox } from "./email/outbox";
import { getGateway, refreshOAuthConnection } from "./payments/connection";
import { deleteMediaIfUnused } from "./storage";

/** Concilia intentos en curso (por si falló una notificación). */
export async function reconcilePendingAttempts(limit = 30) {
  const rows = await db
    .select({ id: paymentAttempts.id })
    .from(paymentAttempts)
    .where(
      and(
        or(inArray(paymentAttempts.status, IN_FLIGHT), and(eq(paymentAttempts.method, "wallet"), eq(paymentAttempts.statusDetail, "preference_created"))),
        or(isNull(paymentAttempts.lastCheckedAt), lt(paymentAttempts.lastCheckedAt, sql`now() - interval '2 minutes'`)),
        lt(paymentAttempts.createdAt, sql`now() - interval '1 minute'`),
      ),
    )
    .limit(limit);
  let ok = 0;
  for (const r of rows) {
    try {
      await reconcileAttempt(r.id);
      ok++;
    } catch {
      /* se reintenta en la próxima corrida */
    }
  }
  return { checked: rows.length, ok };
}

/**
 * Libera reservas vencidas de pedidos sin pago en curso. Nunca libera si hay un pago pendiente
 * (esos extienden la reserva hasta su vencimiento, con tope PENDING_PAYMENT_HOLD_HOURS).
 */
export async function expireReservations(limit = 50) {
  const candidates = await db
    .select()
    .from(orders)
    .where(and(lt(orders.reservationExpiresAt, new Date()), inArray(orders.paymentStatus, ["unpaid", "rejected", "cancelled", "pending", "to_verify", "requires_action"]), isNull(orders.supersededBy)))
    .limit(limit);
  const gw = await getGateway();
  let expired = 0;
  for (const o of candidates) {
    const attempts = await db.select().from(paymentAttempts).where(eq(paymentAttempts.orderId, o.id));
    // Verificar con el proveedor antes de liberar nada.
    for (const a of attempts.filter((x) => IN_FLIGHT.includes(x.status as never))) await reconcileAttempt(a.id).catch(() => null);
    const fresh = await db.select().from(paymentAttempts).where(eq(paymentAttempts.orderId, o.id));
    const [order] = await db.select().from(orders).where(eq(orders.id, o.id));
    if (!order.reservationExpiresAt || order.reservationExpiresAt > new Date()) continue; // extendida por pago pendiente
    if (["approved", "partially_refunded", "refunded", "charged_back"].includes(order.paymentStatus)) continue;
    const stillInFlight = fresh.some((a) => IN_FLIGHT.includes(a.status as never) && !(a.method === "wallet" && a.statusDetail === "preference_created"));
    if (stillInFlight) continue;
    for (const a of fresh.filter((x) => x.method === "wallet" && x.statusDetail === "preference_created")) {
      if (a.providerRef && gw) await gw.expirePreference(a.providerRef).catch(() => null);
      await db.update(paymentAttempts).set({ status: "expired", statusDetail: "preference_expired_reservation", updatedAt: new Date() }).where(eq(paymentAttempts.id, a.id));
    }
    await db.transaction(async (tx) => {
      await releaseReservations(tx, o.id);
      await tx.update(couponRedemptions).set({ status: "released", updatedAt: new Date() }).where(and(eq(couponRedemptions.orderId, o.id), eq(couponRedemptions.status, "reserved")));
      await tx.update(orders).set({ paymentStatus: "expired", fulfillmentStatus: "cancelled", updatedAt: new Date() }).where(eq(orders.id, o.id));
      await tx.insert(orderEvents).values({ orderId: o.id, type: "expired", fromValue: order.paymentStatus, toValue: "expired", message: "Reserva vencida sin pago: se liberó stock y cupón." });
    });
    expired++;
  }
  return { candidates: candidates.length, expired };
}

export async function refreshOAuthTokens() {
  const rows = await db
    .select()
    .from(paymentConnections)
    .where(and(eq(paymentConnections.status, "connected"), eq(paymentConnections.mode, "oauth"), lt(paymentConnections.tokenExpiresAt, sql`now() + interval '15 days'`)));
  for (const r of rows) await refreshOAuthConnection(r.id);
  return { refreshed: rows.length };
}

/**
 * Minimización de datos: borra referencias privadas subidas por clientes que nunca llegaron a un
 * carrito vigente ni a un pedido (7 días). Las de pedidos se conservan con el historial.
 */
export async function purgeOrphanPrivateUploads(limit = 100) {
  const rows = await db.execute<{ id: string }>(sql`
    SELECT m.id FROM media m
    WHERE m.visibility = 'private' AND m.created_at < now() - interval '7 days'
      AND NOT EXISTS (SELECT 1 FROM order_lines l WHERE l.personalization::text LIKE '%' || m.id::text || '%')
      AND NOT EXISTS (SELECT 1 FROM cart_lines c WHERE c.personalization::text LIKE '%' || m.id::text || '%')
      AND NOT EXISTS (SELECT 1 FROM design_proofs d WHERE d.media_id = m.id)
    LIMIT ${limit}`);
  let deleted = 0;
  for (const r of rows) if (await deleteMediaIfUnused(r.id)) deleted++;
  return { deleted };
}

export async function runAllJobs() {
  const out: Record<string, unknown> = {};
  const safe = async (name: string, fn: () => Promise<unknown>) => {
    try {
      out[name] = await fn();
    } catch (e) {
      out[name] = { error: (e as Error).message };
    }
  };
  await safe("webhooks", () => retryFailedWebhooks());
  await safe("reconcile", () => reconcilePendingAttempts());
  await safe("reservations", () => expireReservations());
  await safe("oauth", () => refreshOAuthTokens());
  await safe("emails", () => processEmailOutbox());
  await safe("privateUploads", () => purgeOrphanPrivateUploads());
  return out;
}
