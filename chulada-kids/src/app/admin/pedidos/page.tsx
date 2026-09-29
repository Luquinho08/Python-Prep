import Form from "next/form";
import Link from "next/link";
import { requirePagePermission } from "@/lib/auth/guards";
import { listOrders, parseOrderFilters } from "@/lib/orders/admin-list";
import { orderNumber } from "@/lib/orders/access";
import { formatARS } from "@/lib/money";
import { formatStoreDateTime } from "@/lib/time";
import { FULFILLMENT_LABEL, type FulfillmentStatus } from "@/lib/orders/status";
import { PAYMENT_STATUS_LABEL } from "@/lib/payments/status";
import { FlashFromParams, PageHeader, Table } from "@/components/admin/ui";
import { inputClasses } from "@/components/ui/field";
import { buttonClasses } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export default async function AdminOrders(props: PageProps<"/admin/pedidos">) {
  await requirePagePermission("orders:read");
  const sp = await props.searchParams;
  const f = parseOrderFilters(sp);
  const rows = await listOrders(f);
  const qs = new URLSearchParams(Object.entries(sp).filter(([, v]) => typeof v === "string") as [string, string][]).toString();
  return (
    <div>
      <PageHeader title="Pedidos" description="El estado del pago (lo confirma Mercado Pago) es independiente del estado de elaboración y entrega." actions={<a className={buttonClasses("secondary", "sm")} href={`/api/admin/orders/export?${qs}`}>Exportar CSV</a>} />
      <FlashFromParams sp={sp} />
      <Form action="/admin/pedidos" className="mb-4 grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <div className="lg:col-span-2"><label className="text-xs" htmlFor="oq">Cliente, email, teléfono o número</label><input id="oq" name="q" defaultValue={f.q} className={inputClasses} /></div>
        <div><label className="text-xs" htmlFor="op">Pago</label>
          <select id="op" name="pago" defaultValue={f.pago ?? ""} className={inputClasses}>
            <option value="">Todos</option>
            <option value="approved">Pagados</option>
            <option value="pending">Pendientes / por verificar</option>
            <option value="unpaid">Sin pagar</option>
            <option value="rejected">Rechazados</option>
            <option value="refunded">Reembolsados</option>
            <option value="partially_refunded">Reembolso parcial</option>
            <option value="expired">Vencidos</option>
          </select>
        </div>
        <div><label className="text-xs" htmlFor="oe">Preparación / entrega</label>
          <select id="oe" name="estado" defaultValue={f.estado ?? ""} className={inputClasses}>
            <option value="">Todos</option>
            {Object.entries(FULFILLMENT_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        <div><label className="text-xs" htmlFor="od">Desde</label><input id="od" name="desde" type="date" defaultValue={f.desde} className={inputClasses} /></div>
        <div><label className="text-xs" htmlFor="oh">Hasta</label><input id="oh" name="hasta" type="date" defaultValue={f.hasta} className={inputClasses} /></div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="incidencias" value="1" defaultChecked={f.incidencias} /> Con incidencias</label>
        <div className="flex gap-2"><button className={buttonClasses("primary", "sm")}>Filtrar</button><Link href="/admin/pedidos" className={buttonClasses("ghost", "sm")}>Limpiar</Link></div>
      </Form>
      <Table>
        <thead><tr><th>Pedido</th><th>Fecha</th><th>Cliente</th><th>Total</th><th>Pago</th><th>Preparación</th></tr></thead>
        <tbody>
          {rows.map(({ o, incidents, items }) => (
            <tr key={o.id}>
              <td><Link className="font-semibold underline" href={`/admin/pedidos/${o.id}`}>{orderNumber(o.number)}</Link>{Number(incidents) > 0 ? <div><Badge tone="coral">{incidents} incidencia(s)</Badge></div> : null}</td>
              <td className="text-xs">{formatStoreDateTime(o.createdAt)}</td>
              <td>{o.customerName}<div className="text-xs text-ink-soft">{o.email} · {items} u.</div></td>
              <td>{formatARS(o.totalCents)}</td>
              <td><Badge tone={o.paymentStatus === "approved" ? "mint" : ["pending", "to_verify", "requires_action"].includes(o.paymentStatus) ? "yellow" : "neutral"}>{PAYMENT_STATUS_LABEL[o.paymentStatus]}</Badge></td>
              <td><Badge tone="lavender">{FULFILLMENT_LABEL[o.fulfillmentStatus as FulfillmentStatus]}</Badge></td>
            </tr>
          ))}
          {rows.length === 0 ? <tr><td colSpan={6} className="py-8 text-center text-ink-soft">No hay pedidos con esos filtros.</td></tr> : null}
        </tbody>
      </Table>
    </div>
  );
}
