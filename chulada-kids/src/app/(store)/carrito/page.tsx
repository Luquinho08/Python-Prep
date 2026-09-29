import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { getCartView } from "@/lib/cart/service";
import { getCurrentUser } from "@/lib/auth/session";
import { getComplements } from "@/lib/catalog/queries";
import { checkoutReadinessProblems, getStoreSettings } from "@/lib/content/settings";
import { formatARS } from "@/lib/money";
import { applyCouponAction, removeCouponAction, removeLineAction, updateQuantityAction } from "@/app/actions/cart";
import { EmptyState } from "@/components/ui/empty-state";
import { Alert } from "@/components/ui/alert";
import { ButtonLink, buttonClasses } from "@/components/ui/button";
import { SubmitButton } from "@/components/ui/submit-button";
import { inputClasses } from "@/components/ui/field";
import { ProductGrid } from "@/components/store/product-card";

export const metadata: Metadata = { title: "Carrito", robots: { index: false } };

export default async function CartPage(props: PageProps<"/carrito">) {
  const sp = await props.searchParams;
  const error = typeof sp.error === "string" ? sp.error.slice(0, 200) : null;
  const user = await getCurrentUser();
  const [view, settings] = await Promise.all([getCartView(user?.email ?? null), getStoreSettings()]);
  const problems = checkoutReadinessProblems(settings);

  if (!view.cart || view.lines.length === 0) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-10">
        <h1 className="sr-only">Carrito</h1>
        <EmptyState title="Tu carrito está vacío" action={<ButtonLink href="/productos">Explorar productos</ButtonLink>}>
          Agregá productos desde el catálogo. Tu carrito se guarda en este dispositivo.
        </EmptyState>
      </div>
    );
  }

  const totals = view.totals!;
  // Complementos sugeridos que todavía no están en el carrito (sin interrumpir el checkout).
  const inCart = new Set(view.lines.map((l) => l.productId));
  const suggestions = (await getComplements(view.lines[0].productId, new Date(), 8)).filter((c) => !inCart.has(c.id)).slice(0, 4);

  return (
    <div className="mx-auto max-w-7xl px-4 py-6">
      <h1 className="text-2xl font-bold sm:text-3xl">Carrito</h1>
      {error ? <Alert tone="error" className="mt-4">{error}</Alert> : null}
      {view.hasIssues ? (
        <Alert tone="warning" className="mt-4" title="Revisá tu carrito">
          Algunos productos cambiaron de disponibilidad o configuración. Corregilos para continuar.
        </Alert>
      ) : null}

      <div className="mt-6 grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_360px]">
        <ul className="min-w-0 space-y-4" aria-label="Productos en el carrito">
          {view.lines.map((l) => (
            <li key={l.id} className="flex gap-3 rounded-card border border-line bg-white p-3 sm:gap-4 sm:p-4">
              <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-xl bg-surface-soft sm:h-28 sm:w-28">
                {l.image ? <Image src={l.image.url} alt={l.image.alt} fill sizes="112px" className="object-cover" /> : null}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <Link href={`/productos/${l.productSlug}`} className="font-semibold hover:underline">{l.productName}</Link>
                    <p className="text-sm text-ink-soft">
                      {l.variantName}
                      {l.packUnits > 1 ? ` · pack de ${l.packUnits} ${l.unitLabel}` : ""}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="font-bold">{formatARS(l.lineTotalCents)}</p>
                    {l.promotionDiscountCents + l.couponDiscountCents > 0 ? (
                      <p className="text-xs text-ink-soft line-through">{formatARS(l.lineRegularCents)}</p>
                    ) : null}
                  </div>
                </div>
                {l.personalization.length ? (
                  <dl className="mt-2 grid gap-x-3 gap-y-0.5 rounded-xl bg-surface-soft p-2 text-xs sm:grid-cols-[auto_1fr]">
                    {l.personalization.map((p) => (
                      <div key={p.key} className="contents">
                        <dt className="font-semibold">{p.label}:</dt>
                        <dd className="break-words text-ink-soft">{p.display}</dd>
                      </div>
                    ))}
                  </dl>
                ) : null}
                {l.appliedPromotions.length ? <p className="mt-1 text-xs">Promoción: {l.appliedPromotions.map((p) => p.name).join(" + ")}</p> : null}
                {l.issue ? <p className="mt-2 text-sm font-medium text-danger" role="alert">{l.issue.message}</p> : null}
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <form action={updateQuantityAction} className="flex flex-wrap items-center gap-2">
                    <input type="hidden" name="lineId" value={l.id} />
                    <label htmlFor={`q-${l.id}`} className="text-sm">Cantidad</label>
                    <input
                      id={`q-${l.id}`}
                      name="quantity"
                      type="number"
                      min={l.minQty}
                      step={l.qtyStep}
                      defaultValue={l.quantity}
                      className="h-10 w-20 rounded-xl border-2 border-line text-center"
                    />
                    <SubmitButton variant="secondary" size="sm" pendingLabel="Actualizando…">Actualizar</SubmitButton>
                  </form>
                  <form action={removeLineAction}>
                    <input type="hidden" name="lineId" value={l.id} />
                    <SubmitButton variant="ghost" size="sm" pendingLabel="Quitando…">Quitar</SubmitButton>
                  </form>
                  {l.personalization.length ? (
                    <Link href={`/productos/${l.productSlug}`} className="text-sm text-blue-strong underline">Agregar otra personalización</Link>
                  ) : null}
                </div>
              </div>
            </li>
          ))}
        </ul>

        <aside aria-labelledby="h-resumen" className="h-fit rounded-card border border-line bg-surface-soft p-5 lg:sticky lg:top-4">
          <h2 id="h-resumen" className="text-lg font-bold">Resumen</h2>
          <dl className="mt-3 space-y-2 text-sm">
            <div className="flex justify-between"><dt>Subtotal</dt><dd>{formatARS(totals.subtotalCents)}</dd></div>
            {totals.promotionDiscountCents > 0 ? (
              <div className="flex justify-between"><dt>Promociones</dt><dd>− {formatARS(totals.promotionDiscountCents)}</dd></div>
            ) : null}
            {totals.couponDiscountCents > 0 ? (
              <div className="flex justify-between"><dt>Cupón {totals.coupon?.code}</dt><dd>− {formatARS(totals.couponDiscountCents)}</dd></div>
            ) : null}
            <div className="flex justify-between text-ink-soft"><dt>Envío</dt><dd>Se calcula en el checkout</dd></div>
            <div className="flex justify-between border-t border-line pt-2 text-base font-bold"><dt>Total sin envío</dt><dd>{formatARS(totals.totalCents)}</dd></div>
          </dl>

          <div className="mt-4">
            {view.cart.couponCode ? (
              <div className="rounded-xl bg-white p-3 text-sm">
                <p className={totals.coupon?.ok ? "text-success" : "font-medium text-danger"} role={totals.coupon?.ok ? "status" : "alert"}>
                  {totals.coupon?.message}
                </p>
                <form action={removeCouponAction} className="mt-1">
                  <button className="text-sm underline">Quitar cupón</button>
                </form>
              </div>
            ) : (
              <form action={applyCouponAction} className="flex gap-2">
                <label htmlFor="coupon" className="sr-only">Código de cupón</label>
                <input id="coupon" name="code" placeholder="Cupón de descuento" className={inputClasses} maxLength={40} autoCapitalize="characters" />
                <SubmitButton variant="secondary" pendingLabel="…">Aplicar</SubmitButton>
              </form>
            )}
          </div>

          {problems.length ? (
            <Alert tone="warning" className="mt-4" title="Compra no disponible todavía">{problems.join(" ")}</Alert>
          ) : view.hasIssues ? (
            <p className="mt-4 text-sm font-medium text-danger">Corregí los productos marcados para continuar.</p>
          ) : (
            <Link href="/checkout" className={buttonClasses("primary", "lg", "mt-4 w-full")}>Continuar compra</Link>
          )}
          <Link href="/productos" className="mt-3 block text-center text-sm underline">Seguir comprando</Link>
        </aside>
      </div>

      {suggestions.length ? (
        <section aria-labelledby="h-sug" className="mt-12">
          <h2 id="h-sug" className="text-lg font-bold">¿Te falta algo? (opcional)</h2>
          <div className="mt-4"><ProductGrid products={suggestions} /></div>
        </section>
      ) : null}
    </div>
  );
}
