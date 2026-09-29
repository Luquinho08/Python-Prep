import type { CheckoutSummary } from "@/lib/orders/checkout";
import { formatARS } from "@/lib/money";

export function OrderSummary({ summary, shippingPending = false, title = "Resumen" }: { summary: CheckoutSummary; shippingPending?: boolean; title?: string }) {
  return (
    <section aria-labelledby="h-sum" className="rounded-card border border-line bg-surface-soft p-4 sm:p-5">
      <h2 id="h-sum" className="text-lg font-bold">{title}</h2>
      <ul className="mt-3 divide-y divide-line text-sm">
        {summary.lines.map((l) => (
          <li key={l.id} className="py-2">
            <div className="flex justify-between gap-3">
              <span>
                <strong>{l.name}</strong> <span className="text-ink-soft">· {l.variant} × {l.quantity}{l.packUnits > 1 ? ` (${l.quantity * l.packUnits} ${l.unitLabel})` : ""}</span>
              </span>
              <span className="whitespace-nowrap font-semibold">{formatARS(l.lineTotalCents)}</span>
            </div>
            {l.personalization.length ? (
              <p className="mt-0.5 text-xs text-ink-soft">{l.personalization.map((p) => `${p.label}: ${p.display}`).join(" · ")}</p>
            ) : null}
          </li>
        ))}
      </ul>
      <dl className="mt-3 space-y-1.5 border-t border-line pt-3 text-sm">
        <div className="flex justify-between"><dt>Subtotal</dt><dd>{formatARS(summary.subtotalCents)}</dd></div>
        {summary.promotionDiscountCents > 0 ? <div className="flex justify-between"><dt>Promociones</dt><dd>− {formatARS(summary.promotionDiscountCents)}</dd></div> : null}
        {summary.couponDiscountCents > 0 ? <div className="flex justify-between"><dt>Cupón {summary.couponCode}</dt><dd>− {formatARS(summary.couponDiscountCents)}</dd></div> : null}
        <div className="flex justify-between">
          <dt>Entrega{summary.shippingName ? `: ${summary.shippingName}` : ""}</dt>
          <dd>{shippingPending ? "Elegí un método" : summary.shippingCents === 0 ? "Sin costo" : formatARS(summary.shippingCents)}</dd>
        </div>
        <div className="flex justify-between border-t border-line pt-2 text-base font-bold"><dt>Total a pagar (ARS)</dt><dd>{formatARS(summary.totalCents)}</dd></div>
      </dl>
      {summary.productionDaysMax > 0 || summary.deliveryDaysMax > 0 ? (
        <p className="mt-3 text-xs text-ink-soft">
          {summary.productionDaysMax > 0 ? `Elaboración: hasta ${summary.productionDaysMax} días hábiles desde la confirmación del pago. ` : ""}
          {summary.deliveryDaysMax > 0 ? `Entrega: ${summary.deliveryDaysMin}–${summary.deliveryDaysMax} días hábiles después de la elaboración.` : ""} Son estimaciones, no una fecha de llegada garantizada.
        </p>
      ) : null}
    </section>
  );
}
