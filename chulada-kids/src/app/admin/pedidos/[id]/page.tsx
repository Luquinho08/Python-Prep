import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePagePermission } from "@/lib/auth/guards";
import { can } from "@/lib/auth/permissions";
import { getOrderDetail } from "@/lib/orders/queries";
import { orderLink, orderNumber } from "@/lib/orders/access";
import { paymentHistory } from "@/lib/payments/service";
import { formatARS } from "@/lib/money";
import { formatStoreDate, formatStoreDateTime } from "@/lib/time";
import { FULFILLMENT_LABEL, NEXT_STATES, type FulfillmentStatus } from "@/lib/orders/status";
import { PAYMENT_STATUS_LABEL } from "@/lib/payments/status";
import { Card, FlashFromParams, PageHeader, Table } from "@/components/admin/ui";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import { inputClasses } from "@/components/ui/field";
import { buttonClasses } from "@/components/ui/button";
import { SubmitButton } from "@/components/ui/submit-button";
import { addNoteAction, cancelOrderAction, changeFulfillmentAction, reconcileNowAction, refundAction, resolveIncidentAction } from "../actions";

export default async function AdminOrderDetail(props: PageProps<"/admin/pedidos/[id]">) {
  const user = await requirePagePermission("orders:read");
  const { id } = await props.params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const detail = await getOrderDetail(id, { forStaff: true });
  if (!detail) notFound();
  const { order: o, lines, events, notes, proofs, incidents } = detail;
  const { attempts, payments } = await paymentHistory(id);
  const canWrite = can(user.role, "orders:write");
  const isOwner = can(user.role, "orders:refund");
  const paid = ["approved", "partially_refunded"].includes(o.paymentStatus);
  const next = NEXT_STATES[o.fulfillmentStatus as FulfillmentStatus];
  const needsApproval = lines.some((l) => l.requiresDesignApproval);
  const hidden = <input type="hidden" name="orderId" value={o.id} />;
  const applied = payments.find((p) => p.appliedToOrder);

  return (
    <div className="space-y-5">
      <PageHeader
        title={`Pedido ${orderNumber(o.number)}`}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <Badge tone={paid ? "mint" : "yellow"}>Pago: {PAYMENT_STATUS_LABEL[o.paymentStatus]}</Badge>
            <Badge tone="lavender">{FULFILLMENT_LABEL[o.fulfillmentStatus as FulfillmentStatus]}</Badge>
            <span>Creado {formatStoreDateTime(o.createdAt)}{o.paidAt ? ` · pagado ${formatStoreDateTime(o.paidAt)}` : ""}</span>
          </span>
        }
        actions={<form action={reconcileNowAction}>{hidden}<SubmitButton size="sm" variant="secondary" pendingLabel="Consultando…">Consultar pago en Mercado Pago</SubmitButton></form>}
      />
      <FlashFromParams sp={await props.searchParams} />
      {o.supersededBy ? <Alert tone="info">Pedido reemplazado por otro del mismo carrito (el cliente editó datos). <Link className="underline" href={`/admin/pedidos/${o.supersededBy}`}>Ver el nuevo</Link></Alert> : null}
      {incidents.filter((i) => i.status === "open").map((i) => (
        <Alert key={i.id} tone="error" title={`Incidencia: ${i.kind}`}>
          <pre className="whitespace-pre-wrap text-xs">{JSON.stringify(i.details, null, 2)}</pre>
          {isOwner ? (
            <form action={resolveIncidentAction} className="mt-2 flex flex-wrap gap-2">
              {hidden}<input type="hidden" name="incidentId" value={i.id} />
              <input name="note" placeholder="Cómo se resolvió" aria-label="Cómo se resolvió" className="rounded-lg border-2 border-line px-2 py-1 text-sm" />
              <SubmitButton size="sm" variant="secondary">Marcar resuelta</SubmitButton>
            </form>
          ) : null}
        </Alert>
      ))}

      <div className="grid gap-5 xl:grid-cols-[1.4fr_1fr]">
        <div className="space-y-5">
          <Card title="Productos (precios históricos del pedido)">
            <ul className="divide-y divide-line text-sm">
              {lines.map((l) => (
                <li key={l.id} className="py-2">
                  <div className="flex flex-wrap justify-between gap-2">
                    <span><strong>{l.productName}</strong> · {l.variantName} · SKU {l.sku} · × {l.quantity}{l.packUnits > 1 ? ` (${l.quantity * l.packUnits} ${l.unitLabel})` : ""}</span>
                    <span className="font-semibold">{formatARS(l.lineTotalCents)}</span>
                  </div>
                  <p className="text-xs text-ink-soft">
                    Unit. {formatARS(l.unitPriceCents)} (normal {formatARS(l.regularUnitPriceCents)}){l.surchargeUnitCents ? ` + recargo ${formatARS(l.surchargeUnitCents)}` : ""}
                    {l.appliedPromotions.length ? ` · ${l.appliedPromotions.map((p) => p.name).join(" + ")}` : ""}
                    {l.couponDiscountCents ? ` · cupón −${formatARS(l.couponDiscountCents)}` : ""}
                    {l.requiresDesignApproval ? " · requiere aprobación de diseño" : ""}
                  </p>
                  {l.personalization.length ? (
                    <dl className="mt-1 grid gap-x-3 rounded-lg bg-surface-soft p-2 text-xs sm:grid-cols-[auto_1fr]">
                      {l.personalization.map((p) => (
                        <div key={p.key} className="contents">
                          <dt className="font-semibold">{p.label}</dt>
                          <dd>{p.href ? <a className="underline" href={p.href} target="_blank" rel="noopener">{p.display} (archivo privado)</a> : p.display}</dd>
                        </div>
                      ))}
                    </dl>
                  ) : null}
                </li>
              ))}
            </ul>
            <dl className="mt-3 space-y-1 border-t border-line pt-3 text-sm">
              <div className="flex justify-between"><dt>Subtotal</dt><dd>{formatARS(o.subtotalCents)}</dd></div>
              <div className="flex justify-between"><dt>Promociones</dt><dd>− {formatARS(o.promotionDiscountCents)}</dd></div>
              <div className="flex justify-between"><dt>Cupón {o.couponCode ?? ""}</dt><dd>− {formatARS(o.couponDiscountCents)}</dd></div>
              <div className="flex justify-between"><dt>Envío ({o.shipping.name})</dt><dd>{formatARS(o.shippingCents)}</dd></div>
              <div className="flex justify-between font-bold"><dt>Total cobrado</dt><dd>{formatARS(o.totalCents)}</dd></div>
            </dl>
            <p className="mt-2 text-xs text-ink-soft">Términos aceptados: versión {o.termsVersion} el {formatStoreDateTime(o.termsAcceptedAt)}.</p>
          </Card>

          <Card title="Preparación y entrega">
            {canWrite && next.length ? (
              <form action={changeFulfillmentAction} className="flex flex-wrap items-end gap-2">
                {hidden}
                <div><label className="text-xs" htmlFor="to">Nuevo estado</label>
                  <select id="to" name="to" className={inputClasses}>{next.map((s) => <option key={s} value={s}>{FULFILLMENT_LABEL[s]}</option>)}</select>
                </div>
                <label className="flex items-center gap-2 pb-3 text-sm"><input type="checkbox" name="notify" defaultChecked /> Avisar al cliente</label>
                <SubmitButton size="sm">Actualizar estado</SubmitButton>
              </form>
            ) : <p className="text-sm text-ink-soft">{o.fulfillmentStatus === "awaiting_payment" ? "Esperando la confirmación del pago." : "Sin acciones disponibles en este estado."}</p>}
            {!paid && o.fulfillmentStatus !== "cancelled" ? <p className="mt-2 text-xs text-danger">La producción está bloqueada hasta que el pago esté aprobado.</p> : null}
            {needsApproval ? <p className="mt-2 text-xs text-ink-soft">Este pedido requiere un diseño aprobado antes de “En producción”.</p> : null}
          </Card>

          <Card title="Aprobación de diseño">
            {proofs.length ? (
              <ul className="space-y-1 text-sm">
                {proofs.map((p) => (
                  <li key={p.id}>
                    v{p.version} · <Badge tone={p.status === "approved" ? "mint" : p.status === "pending" ? "yellow" : "neutral"}>{p.status === "approved" ? "Aprobada" : p.status === "pending" ? "Pendiente" : "Cambios pedidos"}</Badge>
                    {p.href ? <> · <a className="underline" href={p.href} target="_blank" rel="noopener">archivo</a></> : null}
                    {p.customerComment ? <span className="text-ink-soft"> — “{p.customerComment}”</span> : null}
                    <span className="text-xs text-ink-soft"> ({formatStoreDateTime(p.createdAt)})</span>
                  </li>
                ))}
              </ul>
            ) : <p className="text-sm text-ink-soft">Sin pruebas enviadas.</p>}
            {canWrite && paid ? (
              <form action={`/api/admin/orders/${o.id}/proof`} method="post" encType="multipart/form-data" className="mt-3 flex flex-wrap items-end gap-2">
                <div><label className="text-xs" htmlFor="proof-file">Archivo de la prueba (imagen o PDF, privado)</label><input id="proof-file" name="file" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" className="block text-sm" /></div>
                <div className="min-w-56 flex-1"><label className="text-xs" htmlFor="proof-note">Mensaje</label><input id="proof-note" name="note" className={inputClasses} /></div>
                <button className={buttonClasses("primary", "sm")}>Enviar para aprobación</button>
              </form>
            ) : null}
          </Card>

          <Card title="Notas">
            {canWrite ? (
              <form action={addNoteAction} className="space-y-2">
                {hidden}
                <label className="text-xs" htmlFor="note-body">Texto</label>
                <textarea id="note-body" name="body" rows={2} className={inputClasses} />
                <div className="flex flex-wrap items-center gap-3 text-sm">
                  <label className="flex items-center gap-1"><input type="radio" name="visibility" value="internal" defaultChecked /> Nota interna (solo equipo)</label>
                  <label className="flex items-center gap-1"><input type="radio" name="visibility" value="customer" /> Mensaje al cliente (lo ve y recibe email)</label>
                  <SubmitButton size="sm">Guardar</SubmitButton>
                </div>
              </form>
            ) : null}
            <ul className="mt-3 space-y-2 text-sm">
              {notes.map((n) => (
                <li key={n.id} className={`rounded-xl p-2 ${n.visibility === "internal" ? "bg-brand-yellow/20" : "bg-brand-mint/30"}`}>
                  <span className="text-xs font-semibold">{n.visibility === "internal" ? "Interna" : "Al cliente"} · {formatStoreDateTime(n.createdAt)}</span>
                  <p className="whitespace-pre-line">{n.body}</p>
                </li>
              ))}
            </ul>
          </Card>
        </div>

        <div className="space-y-5">
          <Card title="Cliente y entrega">
            <p className="text-sm"><strong>{o.customerName}</strong><br />{o.email}<br />{o.phone}{o.userId ? " · con cuenta" : " · invitado"}</p>
            <p className="mt-2 text-sm">{o.shipping.name} ({formatARS(o.shippingCents)})</p>
            {o.address ? <p className="text-sm text-ink-soft">{o.address.street} {o.address.number}{o.address.apartment ? `, ${o.address.apartment}` : ""}, {o.address.city}, {o.address.province} ({o.address.postalCode}){o.address.notes ? ` — ${o.address.notes}` : ""}</p> : null}
            {o.eventDate ? <p className="text-sm">Evento: {formatStoreDate(o.eventDate)}</p> : null}
            {o.customerNotes ? <p className="mt-2 rounded-lg bg-surface-soft p-2 text-sm">“{o.customerNotes}”</p> : null}
            <p className="mt-2 break-all text-xs text-ink-soft">Enlace del cliente: {orderLink(o.id)}</p>
          </Card>

          <Card title="Pagos e intentos">
            <Table>
              <thead><tr><th>Intento</th><th>Estado</th><th>Importe</th></tr></thead>
              <tbody>
                {attempts.map((a) => (
                  <tr key={a.id}>
                    <td className="text-xs">{a.method === "card" ? "Tarjeta (Orders)" : "Cuenta MP (Wallet)"} · {a.driver === "fake" ? "SIMULADOR" : a.environment}<br />{formatStoreDateTime(a.createdAt)}<br /><span className="font-mono">{a.providerRef ?? "—"}</span></td>
                    <td className="text-xs">{PAYMENT_STATUS_LABEL[a.status]}<br />{a.statusDetail}</td>
                    <td className="text-xs">{formatARS(a.amountCents)}{a.installments ? ` · ${a.installments} cuota(s)` : ""}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
            {payments.length ? (
              <ul className="mt-3 space-y-1 text-xs">
                {payments.map((p) => (
                  <li key={p.id}>Pago <span className="font-mono">{p.providerPaymentId}</span>: {PAYMENT_STATUS_LABEL[p.status]} · {formatARS(p.amountCents)} {p.refundedCents ? `(reembolsado ${formatARS(p.refundedCents)})` : ""} {p.appliedToOrder ? "· aplicado al pedido" : "· NO aplicado"}</li>
                ))}
              </ul>
            ) : null}
          </Card>

          {isOwner ? (
            <Card title="Reembolsos y cancelación (propietario)">
              {applied && ["approved", "partially_refunded"].includes(o.paymentStatus) ? (
                <form action={refundAction} className="space-y-2 text-sm">
                  {hidden}
                  <label className="text-xs" htmlFor="ref-amount">Monto a reembolsar (vacío = total restante: {formatARS(applied.amountCents - applied.refundedCents)})</label>
                  <input id="ref-amount" name="amount" className={inputClasses} inputMode="decimal" />
                  <label className="flex items-center gap-2"><input type="checkbox" name="confirm" /> Confirmo el reembolso en Mercado Pago</label>
                  <SubmitButton size="sm" variant="danger" pendingLabel="Reembolsando…">Reembolsar</SubmitButton>
                </form>
              ) : null}
              {o.fulfillmentStatus !== "cancelled" ? (
                <form action={cancelOrderAction} className="mt-4 space-y-2 border-t border-line pt-3 text-sm">
                  {hidden}
                  <label className="text-xs" htmlFor="cancel-reason">Motivo (se informa al cliente)</label>
                  <input id="cancel-reason" name="reason" className={inputClasses} />
                  <label className="flex items-center gap-2"><input type="checkbox" name="restock" defaultChecked /> Devolver stock consumido</label>
                  <label className="flex items-center gap-2"><input type="checkbox" name="confirm" /> Confirmo cancelar{paid ? " y reembolsar el total" : ""}</label>
                  <SubmitButton size="sm" variant="danger" pendingLabel="Cancelando…">Cancelar pedido</SubmitButton>
                </form>
              ) : <p className="text-sm">Pedido cancelado {o.cancelledAt ? formatStoreDateTime(o.cancelledAt) : ""}.</p>}
            </Card>
          ) : null}

          <Card title="Trazabilidad">
            <ol className="space-y-1 text-xs">
              {events.map(({ e, actor }) => (
                <li key={e.id}>
                  <span className="text-ink-soft">{formatStoreDateTime(e.createdAt)}</span> · <strong>{e.type}</strong>
                  {e.fromValue || e.toValue ? ` ${e.fromValue ?? ""} → ${e.toValue ?? ""}` : ""} {e.message ? `— ${e.message}` : ""} <span className="text-ink-soft">({actor ?? e.actorLabel})</span>
                </li>
              ))}
            </ol>
          </Card>
        </div>
      </div>
    </div>
  );
}
