import Link from "next/link";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { requireStaffPage } from "@/lib/auth/guards";
import { can } from "@/lib/auth/permissions";
import { formatARS } from "@/lib/money";
import { daysAgoIso } from "@/lib/time";
import { Alert } from "@/components/ui/alert";
import { Card, PageHeader, Table } from "@/components/admin/ui";

export default async function AdminHome(props: PageProps<"/admin">) {
  const user = await requireStaffPage();
  const sp = await props.searchParams;
  const since = daysAgoIso(30);
  const seeSales = can(user.role, "orders:read");

  const [[counts], [sales], top, lowStock, [incidents], [inquiries]] = await Promise.all([
    db.execute<{ pending: number; to_produce: number; ready: number; awaiting_approval: number }>(sql`
      SELECT
        count(*) FILTER (WHERE payment_status IN ('pending','requires_action','to_verify'))::int AS pending,
        count(*) FILTER (WHERE payment_status = 'approved' AND fulfillment_status IN ('received','awaiting_data','in_production'))::int AS to_produce,
        count(*) FILTER (WHERE fulfillment_status = 'ready')::int AS ready,
        count(*) FILTER (WHERE fulfillment_status = 'awaiting_approval')::int AS awaiting_approval
      FROM orders WHERE superseded_by IS NULL`),
    db.execute<{ approved: number; orders: number; refunded: number }>(sql`
      SELECT
        coalesce(sum(p.amount_cents) FILTER (WHERE p.status IN ('approved','partially_refunded','refunded')), 0)::bigint AS approved,
        count(DISTINCT p.order_id) FILTER (WHERE p.status IN ('approved','partially_refunded','refunded'))::int AS orders,
        coalesce(sum(p.refunded_cents), 0)::bigint AS refunded
      FROM payments p WHERE p.created_at >= ${since}::timestamptz AND p.applied_to_order`),
    db.execute<{ name: string; qty: number }>(sql`
      SELECT ol.product_name AS name, sum(ol.quantity)::int AS qty
      FROM order_lines ol JOIN orders o ON o.id = ol.order_id
      WHERE o.payment_status IN ('approved','partially_refunded') AND o.paid_at >= ${since}::timestamptz
      GROUP BY ol.product_name ORDER BY qty DESC LIMIT 5`),
    db.execute<{ product: string; variant: string; product_id: string; stock: number; available: number; mode: string }>(sql`
      SELECT p.name AS product, v.name AS variant, p.id AS product_id, v.stock_on_hand AS stock, p.inventory_mode AS mode,
        v.stock_on_hand - coalesce((SELECT sum(r.quantity) FROM stock_reservations r WHERE r.variant_id = v.id AND r.status = 'active' AND r.expires_at > now()), 0)::int AS available
      FROM product_variants v JOIN products p ON p.id = v.product_id
      WHERE p.status = 'published' AND v.is_active AND NOT p.is_quote_only
        AND v.stock_on_hand - coalesce((SELECT sum(r.quantity) FROM stock_reservations r WHERE r.variant_id = v.id AND r.status = 'active' AND r.expires_at > now()), 0) <= v.low_stock_threshold
      ORDER BY available ASC LIMIT 10`),
    db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM incidents WHERE status = 'open'`),
    db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM inquiries WHERE status = 'new'`),
  ]);

  const stat = (label: string, value: string | number, href?: string) => (
    <div className="rounded-card border border-line bg-white p-4">
      <p className="text-xs text-ink-soft">{label}</p>
      <p className="mt-1 text-2xl font-bold">{value}</p>
      {href ? <Link href={href} className="text-xs underline">Ver</Link> : null}
    </div>
  );

  return (
    <div className="space-y-6">
      <PageHeader title="Resumen" description="Últimos 30 días. Facturación ≠ rentabilidad: no se calculan ganancias sin costos cargados." />
      {sp.sin_permiso ? <Alert tone="warning">Tu rol no tiene acceso a esa sección.</Alert> : null}
      {Number(incidents.n) > 0 && seeSales ? (
        <Alert tone="error" title={`${incidents.n} incidencia(s) de pago/stock abiertas`}>
          Requieren revisión del propietario. <Link className="underline" href="/admin/pedidos?incidencias=1">Ver incidencias</Link>
        </Alert>
      ) : null}
      {seeSales ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {stat("Ventas aprobadas (facturación)", formatARS(Number(sales.approved)))}
          {stat("Pedidos pagados", Number(sales.orders), "/admin/pedidos?pago=approved")}
          {stat("Devoluciones", formatARS(Number(sales.refunded)))}
          {stat("Pagos pendientes / por verificar", counts.pending, "/admin/pedidos?pago=pending")}
          {stat("Para producir", counts.to_produce, "/admin/pedidos?estado=received")}
          {stat("Esperando aprobación de diseño", counts.awaiting_approval, "/admin/pedidos?estado=awaiting_approval")}
          {stat("Listos para entregar", counts.ready, "/admin/pedidos?estado=ready")}
          {stat("Consultas nuevas", Number(inquiries.n), "/admin/clientes")}
        </div>
      ) : null}
      <div className="grid gap-4 lg:grid-cols-2">
        {seeSales ? (
          <Card title="Más vendidos (pedidos pagados)">
            {top.length ? (
              <ol className="space-y-1 text-sm">{top.map((t) => <li key={t.name} className="flex justify-between"><span>{t.name}</span><strong>{t.qty}</strong></li>)}</ol>
            ) : <p className="text-sm text-ink-soft">Todavía no hay ventas aprobadas.</p>}
          </Card>
        ) : null}
        <Card title="Stock o cupos bajos">
          {lowStock.length ? (
            <Table>
              <thead><tr><th>Producto</th><th>Variante</th><th>Disponible</th></tr></thead>
              <tbody>
                {lowStock.map((r) => (
                  <tr key={`${r.product_id}-${r.variant}`}>
                    <td><Link className="underline" href={`/admin/productos/${r.product_id}`}>{r.product}</Link></td>
                    <td>{r.variant}</td>
                    <td className={Number(r.available) <= 0 ? "font-semibold text-danger" : ""}>{r.available}{r.mode === "capacity" ? " cupos" : ""}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          ) : <p className="text-sm text-ink-soft">Sin alertas de stock.</p>}
        </Card>
      </div>
    </div>
  );
}
