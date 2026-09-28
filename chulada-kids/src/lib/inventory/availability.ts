import "server-only";
import { and, eq, gt, inArray, sql } from "drizzle-orm";
import { db, type DbOrTx } from "../db";
import { productVariants, stockReservations } from "../db/schema";

/** Reservas activas y vigentes por variante. */
export async function activeReservedByVariant(variantIds: string[], tx: DbOrTx = db): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (variantIds.length === 0) return map;
  const rows = await tx
    .select({ variantId: stockReservations.variantId, qty: sql<number>`coalesce(sum(${stockReservations.quantity}), 0)::int` })
    .from(stockReservations)
    .where(
      and(
        inArray(stockReservations.variantId, variantIds),
        eq(stockReservations.status, "active"),
        gt(stockReservations.expiresAt, new Date()),
      ),
    )
    .groupBy(stockReservations.variantId);
  for (const r of rows) map.set(r.variantId, Number(r.qty));
  return map;
}

/** Disponible = existencia − reservas activas vigentes (nunca negativo). */
export async function availableByVariant(variantIds: string[], tx: DbOrTx = db): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  if (variantIds.length === 0) return result;
  const [variants, reserved] = await Promise.all([
    tx.select({ id: productVariants.id, stock: productVariants.stockOnHand }).from(productVariants).where(inArray(productVariants.id, variantIds)),
    activeReservedByVariant(variantIds, tx),
  ]);
  for (const v of variants) result.set(v.id, Math.max(0, v.stock - (reserved.get(v.id) ?? 0)));
  return result;
}

export type AvailabilityState = "in_stock" | "low" | "out" | "made_to_order" | "backorder";

export function availabilityState(opts: {
  available: number;
  lowThreshold: number;
  inventoryMode: "stock" | "capacity";
  allowBackorder: boolean;
}): AvailabilityState {
  if (opts.available <= 0) return opts.allowBackorder ? "backorder" : "out";
  if (opts.inventoryMode === "capacity") return "made_to_order";
  return opts.available <= opts.lowThreshold ? "low" : "in_stock";
}

export const AVAILABILITY_LABEL: Record<AvailabilityState, string> = {
  in_stock: "Disponible",
  low: "Últimas unidades",
  out: "Agotado",
  made_to_order: "A pedido",
  backorder: "Por encargo",
};
