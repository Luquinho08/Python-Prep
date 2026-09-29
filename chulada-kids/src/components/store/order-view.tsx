import Link from "next/link";
import type { getOrderDetail } from "@/lib/orders/queries";
import { formatARS } from "@/lib/money";
import { formatStoreDate, formatStoreDateTime } from "@/lib/time";
import { FULFILLMENT_LABEL, type FulfillmentStatus } from "@/lib/orders/status";
import { PAYMENT_STATUS_LABEL } from "@/lib/payments/status";
import { orderNumber } from "@/lib/orders/access";
import { decideProofAction } from "@/app/actions/order-customer";
import { Badge } from "../ui/badge";
import { Alert } from "../ui/alert";
import { SubmitButton } from "../ui/submit-button";
import { inputClasses } from "../ui/field";

type Detail = NonNullable<Awaited<ReturnType<typeof getOrderDetail>>>;

export function OrderView({ detail, token, pickupAddress }: { detail: Detail; token: string | null; pickupAddress?: string }) {
  const { order: o, lines, events, notes, proofs } = detail;
  const pendingProof = proofs.find((p) => p.status === "pending");
  const paid = ["approved", "partially_refunded"].includes(o.paymentStatus);
  const payable = ["unpaid", "rejected"].includes(o.paymentStatus) && !o.supersededBy && !!o.reservationExpiresAt && o.reservationExpiresAt > new Date();
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-bold">Pedido {orderNumber(o.number)}</h1>
        <Badge tone={paid ? "mint" : "yellow"}>{PAYMENT_STATUS_LABEL[o.paymentStatus]}</Badge>
        <Badge tone="lavender">{FULFILLMENT_LABEL[o.fulfillmentStatus as FulfillmentStatus]}</Badge>
      </div>
      <p className="text-sm text-ink-soft">
        Realizado el {formatStoreDateTime(o.createdAt)} · {o.customerName} · {o.email}
      </p>
      {o.supersededBy ? <Alert tone="info">Este pedido fue reemplazado por uno más reciente al editar los datos.</Alert> : null}
      {payable && token ? (
        <Alert tone="warning" title="Falta el pago">
          <Link className="underline" href={`/checkout?pedido=${o.id}&t=${encodeURIComponent(token)}`}>Elegir cómo pagar</Link>
        </Alert>
      ) : null}

      {pendingProof ? (
        <section className="rounded-card border-2 border-brand-lavender bg-brand-lavender/10 p-4">
          <h2 className="text-lg font-bold">Revisá tu diseño (versión {pendingProof.version})</h2>
          {pendingProof.note ? <p className="mt-1 text-sm">{pendingProof.note}</p> : null}
          {pendingProof.href ? (
            <a href={pendingProof.href} className="mt-2 inline-block underline" target="_blank" rel="noopener">
              Ver prueba de diseño
            </a>
          ) : null}
          <form action={decideProofAction} className="mt-3 space-y-2">
            <input type="hidden" name="orderId" value={o.id} />
            <input type="hidden" name="t" value={token ?? ""} />
            <label htmlFor="proof-comment" className="text-sm">
              Comentarios (recomendado si pedís cambios)
            </label>
            <textarea id="proof-comment" name="comment" rows={2} className={inputClasses} maxLength={1000} />
            <div className="flex flex-wrap gap-2">
              <SubmitButton name="decision" value="approve" pendingLabel="Enviando…">
                Aprobar diseño
              </SubmitButton>
              <SubmitButton name="decision" value="changes" variant="secondary" pendingLabel="Enviando…">
                Pedir cambios
              </SubmitButton>
            </div>
          </form>
        </section>
      ) : null}

      <section aria-labelledby="h-items" className="rounded-card border border-line bg-white p-4">
        <h2 id="h-items" className="font-bold">
          Productos
        </h2>
        <ul className="mt-2 divide-y divide-line text-sm">
          {lines.map((l) => (
            <li key={l.id} className="py-2">
              <div className="flex justify-between gap-2">
                <span>
                  <strong>{l.productName}</strong> · {l.variantName} × {l.quantity}
                </span>
                <span className="font-semibold">{formatARS(l.lineTotalCents)}</span>
              </div>
              {l.personalization.length ? (
                <ul className="mt-1 text-xs text-ink-soft">
                  {l.personalization.map((p) => (
                    <li key={p.key}>
                      {p.label}:{" "}
                      {p.href ? (
                        <a href={p.href} className="underline" target="_blank" rel="noopener">
                          {p.display}
                        </a>
                      ) : (
                        p.display
                      )}
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          ))}
        </ul>
        <dl className="mt-3 space-y-1 border-t border-line pt-3 text-sm">
          <div className="flex justify-between"><dt>Subtotal</dt><dd>{formatARS(o.subtotalCents)}</dd></div>
          {o.promotionDiscountCents ? <div className="flex justify-between"><dt>Promociones</dt><dd>− {formatARS(o.promotionDiscountCents)}</dd></div> : null}
          {o.couponDiscountCents ? <div className="flex justify-between"><dt>Cupón {o.couponCode}</dt><dd>− {formatARS(o.couponDiscountCents)}</dd></div> : null}
          <div className="flex justify-between"><dt>Entrega ({o.shipping.name})</dt><dd>{o.shippingCents ? formatARS(o.shippingCents) : "Sin costo"}</dd></div>
          <div className="flex justify-between font-bold"><dt>Total</dt><dd>{formatARS(o.totalCents)}</dd></div>
        </dl>
      </section>

      <section className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-card border border-line bg-white p-4 text-sm">
          <h2 className="font-bold">Entrega</h2>
          <p className="mt-1">{o.shipping.name}</p>
          {o.address ? (
            <p className="text-ink-soft">
              {o.address.street} {o.address.number}
              {o.address.apartment ? `, ${o.address.apartment}` : ""}, {o.address.city}, {o.address.province} ({o.address.postalCode})
            </p>
          ) : null}
          {o.shipping.kind === "pickup" && paid && pickupAddress ? <p className="text-ink-soft">Retiro: {pickupAddress}</p> : null}
          {o.eventDate ? <p className="mt-1">Fecha del evento: {formatStoreDate(o.eventDate)}</p> : null}
          <p className="mt-1 text-xs text-ink-soft">Los plazos son estimados: elaboración y entrega se informan por separado.</p>
        </div>
        <div className="rounded-card border border-line bg-white p-4 text-sm">
          <h2 className="font-bold">Seguimiento</h2>
          <ol className="mt-1 space-y-1">
            {events.map(({ e }) => (
              <li key={e.id} className="text-ink-soft">
                <span className="text-xs">{formatStoreDateTime(e.createdAt)}</span> —{" "}
                {e.type === "payment_status"
                  ? `Pago: ${PAYMENT_STATUS_LABEL[e.toValue ?? ""] ?? e.toValue}`
                  : e.type === "fulfillment_status"
                    ? `Estado: ${FULFILLMENT_LABEL[(e.toValue ?? "received") as FulfillmentStatus]}`
                    : e.type === "created"
                      ? "Pedido creado"
                      : e.message}
              </li>
            ))}
          </ol>
        </div>
      </section>
      {notes.length ? (
        <section className="rounded-card border border-line bg-white p-4 text-sm">
          <h2 className="font-bold">Mensajes de Chulada Kids</h2>
          <ul className="mt-2 space-y-2">
            {notes.map((n) => (
              <li key={n.id}>
                <span className="text-xs text-ink-soft">{formatStoreDateTime(n.createdAt)}</span>
                <p className="whitespace-pre-line">{n.body}</p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
