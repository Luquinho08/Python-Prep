import Form from "next/form";
import Link from "next/link";
import { desc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { inquiries, products } from "@/lib/db/schema";
import { requirePagePermission } from "@/lib/auth/guards";
import { formatARS } from "@/lib/money";
import { formatStoreDateTime } from "@/lib/time";
import { Card, FlashFromParams, PageHeader, Table } from "@/components/admin/ui";
import { inputClasses } from "@/components/ui/field";
import { buttonClasses } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { setInquiryStatusAction } from "./actions";

export default async function CustomersAdmin(props: PageProps<"/admin/clientes">) {
  await requirePagePermission("customers:read");
  const sp = await props.searchParams;
  const q = typeof sp.q === "string" ? sp.q.trim().toLowerCase().slice(0, 80) : "";
  const like = `%${q.replace(/[%_\\]/g, "")}%`;
  const customers = await db.execute<{ email: string; name: string; phone: string; orders: number; paid: number; last: string; has_account: boolean }>(sql`
    SELECT o.email, max(o.customer_name) AS name, max(o.phone) AS phone, count(*)::int AS orders,
      coalesce(sum(o.total_cents) FILTER (WHERE o.payment_status IN ('approved','partially_refunded')), 0)::bigint AS paid,
      max(o.created_at) AS last, bool_or(o.user_id IS NOT NULL) AS has_account
    FROM orders o
    WHERE o.superseded_by IS NULL ${q ? sql`AND (lower(o.email) LIKE ${like} OR lower(o.customer_name) LIKE ${like} OR o.phone LIKE ${like})` : sql``}
    GROUP BY o.email ORDER BY last DESC LIMIT 100`);
  const inq = await db
    .select({ i: inquiries, product: products.name })
    .from(inquiries)
    .leftJoin(products, eq(products.id, inquiries.productId))
    .orderBy(desc(inquiries.createdAt))
    .limit(50);
  return (
    <div className="space-y-6">
      <PageHeader title="Clientes y consultas" description="Clientes agrupados por email de compra. Un email de invitado no prueba identidad." />
      <FlashFromParams sp={sp} />
      <Form action="/admin/clientes" className="flex gap-2">
        <label htmlFor="cq" className="sr-only">Buscar cliente</label>
        <input id="cq" name="q" defaultValue={q} placeholder="Email, nombre o teléfono" className={`${inputClasses} max-w-sm`} />
        <button className={buttonClasses("secondary")}>Buscar</button>
      </Form>
      <Table>
        <thead><tr><th>Cliente</th><th>Pedidos</th><th>Pagado</th><th>Último</th><th></th></tr></thead>
        <tbody>
          {customers.map((c) => (
            <tr key={c.email}>
              <td>{c.name}<div className="text-xs text-ink-soft">{c.email} · {c.phone}{c.has_account ? " · con cuenta" : ""}</div></td>
              <td>{c.orders}</td>
              <td>{formatARS(Number(c.paid))}</td>
              <td className="text-xs">{formatStoreDateTime(c.last)}</td>
              <td><Link className="underline" href={`/admin/pedidos?q=${encodeURIComponent(c.email)}`}>Ver pedidos</Link></td>
            </tr>
          ))}
          {customers.length === 0 ? <tr><td colSpan={5} className="py-6 text-center text-ink-soft">Sin clientes todavía.</td></tr> : null}
        </tbody>
      </Table>
      <Card title="Consultas y pedidos de presupuesto">
        {inq.length === 0 ? <p className="text-sm">Sin consultas.</p> : (
          <ul className="space-y-3">
            {inq.map(({ i, product }) => (
              <li key={i.id} className="rounded-2xl border border-line p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p><strong>{i.name}</strong> · <a className="underline" href={`mailto:${i.email}`}>{i.email}</a> {i.phone ? `· ${i.phone}` : ""} {product ? `· ${product}` : ""}</p>
                  <div className="flex items-center gap-2">
                    <Badge tone={i.status === "new" ? "yellow" : "neutral"}>{i.kind === "quote" ? "Presupuesto" : "Contacto"} · {i.status === "new" ? "Nueva" : i.status === "answered" ? "Respondida" : "Archivada"}</Badge>
                    <form action={setInquiryStatusAction}>
                      <input type="hidden" name="id" value={i.id} />
                      <button name="status" value="answered" className="text-xs underline">Marcar respondida</button>{" "}
                      <button name="status" value="archived" className="text-xs underline">Archivar</button>
                    </form>
                  </div>
                </div>
                <p className="mt-1 whitespace-pre-line text-ink-soft">{i.message}</p>
                <p className="mt-1 text-xs text-ink-soft">{formatStoreDateTime(i.createdAt)}</p>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
