import "server-only";
import { and, eq, inArray, ne, sql } from "drizzle-orm";
import type { Tx } from "../db";
import { productVariants, stockReservations } from "../db/schema";

/** Bloquea variantes en orden estable (evita deadlocks) y devuelve existencias. */
export async function lockVariants(tx: Tx, variantIds: string[]) {
  const ids = [...new Set(variantIds)].sort();
  if (ids.length === 0) return new Map<string, number>();
  const rows = await tx.execute<{ id: string; stock_on_hand: number }>(
    sql`SELECT id, stock_on_hand FROM product_variants WHERE id IN ${ids} ORDER BY id FOR UPDATE`,
  );
  return new Map(rows.map((r) => [r.id, Number(r.stock_on_hand)]));
}

/** Reservas activas y vigentes por variante, opcionalmente excluyendo las de un pedido o una reserva. */
export async function activeReserved(tx: Tx, variantIds: string[], exclude: { orderId?: string; reservationId?: string } = {}) {
  const map = new Map<string, number>();
  if (variantIds.length === 0) return map;
  const rows = await tx
    .select({ variantId: stockReservations.variantId, qty: sql<number>`coalesce(sum(${stockReservations.quantity}),0)::int` })
    .from(stockReservations)
    .where(
      and(
        inArray(stockReservations.variantId, variantIds),
        eq(stockReservations.status, "active"),
        sql`${stockReservations.expiresAt} > now()`,
        exclude.orderId ? ne(stockReservations.orderId, exclude.orderId) : sql`true`,
        exclude.reservationId ? ne(stockReservations.id, exclude.reservationId) : sql`true`,
      ),
    )
    .groupBy(stockReservations.variantId);
  for (const r of rows) map.set(r.variantId, Number(r.qty));
  return map;
}

export async function releaseReservations(tx: Tx, orderId: string) {
  await tx
    .update(stockReservations)
    .set({ status: "released", updatedAt: new Date() })
    .where(and(eq(stockReservations.orderId, orderId), eq(stockReservations.status, "active")));
}

export async function extendReservations(tx: Tx, orderId: string, until: Date) {
  await tx
    .update(stockReservations)
    .set({ expiresAt: until, updatedAt: new Date() })
    .where(and(eq(stockReservations.orderId, orderId), eq(stockReservations.status, "active"), sql`${stockReservations.expiresAt} < ${until.toISOString()}::timestamptz`));
}

/**
 * Pago aprobado: consume reservas y descuenta existencia una sola vez.
 * Si una reserva venció o se liberó, intenta reasignar stock de forma atómica.
 * Devuelve faltantes (para abrir incidencia): nunca se promete stock inexistente.
 */
export async function consumeForApprovedOrder(tx: Tx, orderId: string, allowBackorderByVariant: Map<string, boolean>) {
  const res = await tx.select().from(stockReservations).where(and(eq(stockReservations.orderId, orderId), ne(stockReservations.status, "consumed")));
  const stock = await lockVariants(tx, res.map((r) => r.variantId));
  const shortages: { variantId: string; requested: number; available: number }[] = [];
  for (const r of res) {
    const others = (await activeReserved(tx, [r.variantId], { reservationId: r.id })).get(r.variantId) ?? 0;
    const onHand = stock.get(r.variantId) ?? 0;
    const available = onHand - others;
    const backorder = allowBackorderByVariant.get(r.variantId) ?? false;
    if (available >= r.quantity || backorder) {
      const next = Math.max(0, onHand - r.quantity);
      await tx.update(productVariants).set({ stockOnHand: next, updatedAt: new Date() }).where(eq(productVariants.id, r.variantId));
      stock.set(r.variantId, next);
      await tx.update(stockReservations).set({ status: "consumed", updatedAt: new Date() }).where(eq(stockReservations.id, r.id));
    } else {
      shortages.push({ variantId: r.variantId, requested: r.quantity, available: Math.max(0, available) });
      await tx.update(stockReservations).set({ status: "released", updatedAt: new Date() }).where(eq(stockReservations.id, r.id));
    }
  }
  return shortages;
}

/** Devuelve el stock consumido (cancelación/reembolso total antes de producir, si el propietario lo decide). */
export async function restockOrder(tx: Tx, orderId: string) {
  const res = await tx.select().from(stockReservations).where(and(eq(stockReservations.orderId, orderId), eq(stockReservations.status, "consumed")));
  await lockVariants(tx, res.map((r) => r.variantId));
  for (const r of res) {
    await tx.update(productVariants).set({ stockOnHand: sql`${productVariants.stockOnHand} + ${r.quantity}`, updatedAt: new Date() }).where(eq(productVariants.id, r.variantId));
    await tx.update(stockReservations).set({ status: "released", updatedAt: new Date() }).where(eq(stockReservations.id, r.id));
  }
}
