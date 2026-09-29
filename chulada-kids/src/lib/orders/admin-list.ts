import "server-only";
import { and, desc, eq, gte, isNull, lt, sql, type SQL } from "drizzle-orm";
import { db } from "../db";
import { orders } from "../db/schema";
import { storeLocalToUtc } from "../time";

export type OrderFilters = { q?: string; pago?: string; estado?: string; desde?: string; hasta?: string; incidencias?: boolean };

export function parseOrderFilters(sp: Record<string, string | string[] | undefined>): OrderFilters {
  const s = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string).slice(0, 80) : undefined);
  return { q: s("q"), pago: s("pago"), estado: s("estado"), desde: s("desde"), hasta: s("hasta"), incidencias: sp.incidencias === "1" };
}

export async function listOrders(f: OrderFilters, limit = 100) {
  const where: SQL[] = [isNull(orders.supersededBy)];
  if (f.q) {
    const q = f.q.trim().toLowerCase().replace(/[%_\\]/g, "");
    const num = Number(q.replace(/^ck-?/, ""));
    where.push(sql`(lower(${orders.email}) LIKE ${`%${q}%`} OR lower(${orders.customerName}) LIKE ${`%${q}%`} OR ${orders.phone} LIKE ${`%${q}%`}${Number.isInteger(num) && num > 0 ? sql` OR ${orders.number} = ${num}` : sql``})`);
  }
  if (f.pago === "pending") where.push(sql`${orders.paymentStatus} IN ('pending','requires_action','to_verify')`);
  else if (f.pago) where.push(eq(orders.paymentStatus, f.pago as "approved"));
  if (f.estado) where.push(eq(orders.fulfillmentStatus, f.estado as "received"));
  if (f.desde && /^\d{4}-\d{2}-\d{2}$/.test(f.desde)) where.push(gte(orders.createdAt, storeLocalToUtc(f.desde)));
  if (f.hasta && /^\d{4}-\d{2}-\d{2}$/.test(f.hasta)) where.push(lt(orders.createdAt, new Date(storeLocalToUtc(f.hasta).getTime() + 86400_000)));
  if (f.incidencias) where.push(sql`EXISTS (SELECT 1 FROM incidents i WHERE i.order_id = ${orders.id} AND i.status = 'open')`);
  return db
    .select({
      o: orders,
      incidents: sql<number>`(SELECT count(*)::int FROM incidents i WHERE i.order_id = ${orders.id} AND i.status = 'open')`,
      items: sql<number>`(SELECT coalesce(sum(quantity),0)::int FROM order_lines l WHERE l.order_id = ${orders.id})`,
    })
    .from(orders)
    .where(and(...where))
    .orderBy(desc(orders.createdAt))
    .limit(limit);
}
