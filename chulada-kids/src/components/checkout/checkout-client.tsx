"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { createOrderAction, quoteAction, shippingOptionsAction } from "@/app/actions/checkout";
import type { CheckoutSummary } from "@/lib/orders/checkout";
import { formatARS } from "@/lib/money";
import { formatStoreDateTime } from "@/lib/time";
import { Alert } from "../ui/alert";
import { Button } from "../ui/button";
import { Field, Input, Textarea } from "../ui/field";
import { OrderSummary } from "./order-summary";
import { PaymentStep } from "./payment-step";

type Method = { id: string; name: string; kind: "pickup" | "delivery"; description: string; priceCents: number; deliveryDaysMin: number; deliveryDaysMax: number };
type PlacedOrder = { orderId: string; orderNumber: string; accessToken: string; summary: CheckoutSummary; reservationExpiresAt: string; email: string };

type Props = {
  initialSummary: CheckoutSummary;
  prefill: { name: string; email: string; phone: string };
  payment: { driver: "mercadopago" | "fake"; publicKey: string | null; cardEnabled: boolean; walletEnabled: boolean; environment: string | null };
  resume: PlacedOrder | null;
};

export function CheckoutClient({ initialSummary, prefill, payment, resume }: Props) {
  const [form, setForm] = useState({ ...prefill, postalCode: "", street: "", number: "", apartment: "", city: "", province: "", addressNotes: "", notes: "" });
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [methods, setMethods] = useState<Method[] | null>(null);
  const [cpChecked, setCpChecked] = useState<string | null>(null);
  const [methodId, setMethodId] = useState<string | null>(null);
  const [summary, setSummary] = useState<CheckoutSummary>(initialSummary);
  const [quoteIssues, setQuoteIssues] = useState<string[]>([]);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<{ tone: "error" | "warning"; text: string } | null>(null);
  const [changed, setChanged] = useState<CheckoutSummary | null>(null);
  const [order, setOrder] = useState<PlacedOrder | null>(resume);
  const [pending, startTransition] = useTransition();
  const keyRef = useRef<string>("");
  const router = useRouter();

  // Clave de idempotencia del checkout: sobrevive a recargas de la pestaña (doble envío = mismo pedido).
  useEffect(() => {
    try {
      keyRef.current = sessionStorage.getItem("ck_checkout_key") ?? crypto.randomUUID();
      sessionStorage.setItem("ck_checkout_key", keyRef.current);
    } catch {
      keyRef.current = crypto.randomUUID();
    }
  }, []);

  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => {
    setForm((f) => ({ ...f, [k]: e.target.value }));
    setFieldErrors((fe) => ({ ...fe, [k]: "" }));
  };
  const selected = methods?.find((m) => m.id === methodId) ?? null;

  function lookupShipping() {
    const cp = form.postalCode.trim();
    startTransition(async () => {
      const res = await shippingOptionsAction(cp);
      setMethods(res.methods);
      setCpChecked(res.postalCode);
      if (!res.methods.some((m) => m.id === methodId)) setMethodId(null);
      if (res.methods.length === 0) setMessage({ tone: "warning", text: "No encontramos métodos de entrega disponibles. Escribinos por la página de contacto para coordinar." });
      else if (!res.postalCode && res.hasDelivery) setMessage({ tone: "warning", text: "Ingresá un código postal válido (4 dígitos) para ver envíos a domicilio. Mientras tanto podés elegir retiro." });
      else setMessage(null);
    });
  }

  // Recalcular el total al elegir método de entrega (el costo se conoce antes de pagar).
  useEffect(() => {
    if (!methodId) return;
    let alive = true;
    quoteAction({ shippingMethodId: methodId, postalCode: form.postalCode, email: form.email || null }).then((q) => {
      if (!alive || !q) return;
      setSummary(q.summary);
      setQuoteIssues(q.issues);
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [methodId]);

  function submit(expectedTotal: number) {
    setMessage(null);
    setFieldErrors({});
    const fe: Record<string, string> = {};
    if (!methodId) fe.shippingMethodId = "Elegí un método de entrega.";
    if (!acceptTerms) fe.acceptTerms = "Tenés que aceptar los términos y condiciones.";
    if (Object.keys(fe).length) {
      setFieldErrors(fe);
      setMessage({ tone: "error", text: "Revisá los datos marcados." });
      return;
    }
    startTransition(async () => {
      try {
        const res = await createOrderAction({ ...form, checkoutKey: keyRef.current, shippingMethodId: methodId, acceptTerms, expectedTotalCents: expectedTotal });
        if (res.ok) {
          const placed = { orderId: res.orderId, orderNumber: res.orderNumber, accessToken: res.accessToken, summary: res.summary, reservationExpiresAt: res.reservationExpiresAt, email: form.email.trim().toLowerCase() };
          setOrder(placed);
          setChanged(null);
          try {
            sessionStorage.removeItem("ck_checkout_key");
          } catch {
            /* sin almacenamiento */
          }
          // El pedido queda en la URL: una recarga retoma el mismo pedido sin duplicarlo.
          router.replace(`/checkout?pedido=${placed.orderId}&t=${encodeURIComponent(placed.accessToken)}`, { scroll: true });
        } else if (res.kind === "changed") {
          setChanged(res.summary);
          setSummary(res.summary);
          setMessage({ tone: "warning", text: res.message });
        } else {
          setFieldErrors(res.fieldErrors ?? {});
          setMessage({ tone: "error", text: res.message });
        }
      } catch {
        setMessage({ tone: "error", text: "Se interrumpió la conexión. Volvé a intentar: no se duplicará tu pedido." });
      }
    });
  }

  function editData() {
    router.replace("/checkout");
    try {
      keyRef.current = crypto.randomUUID();
      sessionStorage.setItem("ck_checkout_key", keyRef.current);
    } catch {
      keyRef.current = crypto.randomUUID();
    }
    setOrder(null);
  }

  if (order) {
    return (
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-5">
          <Alert tone="info" title={`Pedido ${order.orderNumber} creado — falta el pago`}>
            Reservamos los productos hasta las {formatStoreDateTime(order.reservationExpiresAt)}. El pedido se confirma solo cuando Mercado Pago aprueba el pago.{" "}
            <button type="button" onClick={editData} className="font-semibold underline">Editar datos o entrega</button>
          </Alert>
          <PaymentStep
            orderId={order.orderId}
            orderNumber={order.orderNumber}
            accessToken={order.accessToken}
            totalCents={order.summary.totalCents}
            email={order.email}
            driver={payment.driver}
            publicKey={payment.publicKey}
            cardEnabled={payment.cardEnabled}
            walletEnabled={payment.walletEnabled}
          />
        </div>
        <div className="lg:sticky lg:top-4 lg:self-start">
          <OrderSummary summary={order.summary} title="Revisión final" />
        </div>
      </div>
    );
  }

  const shippingPending = !selected;
  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        submit(changed?.totalCents ?? summary.totalCents);
      }}
      className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_380px]"
    >
      <div className="space-y-6">
        <section aria-labelledby="h-datos" className="rounded-card border border-line bg-white p-4 sm:p-5">
          <h2 id="h-datos" className="text-lg font-bold">1. Tus datos</h2>
          <p className="text-sm text-ink-soft">Comprás como invitado; no hace falta crear cuenta.</p>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Field id="c-name" label="Nombre y apellido" required error={fieldErrors.name} className="sm:col-span-2">
              {(a) => <Input {...a} value={form.name} onChange={set("name")} autoComplete="name" />}
            </Field>
            <Field id="c-email" label="Email" required error={fieldErrors.email} hint="Te enviamos la confirmación y el enlace de seguimiento.">
              {(a) => <Input {...a} type="email" value={form.email} onChange={set("email")} autoComplete="email" />}
            </Field>
            <Field id="c-phone" label="Teléfono" required error={fieldErrors.phone} hint="Para coordinar la entrega.">
              {(a) => <Input {...a} type="tel" value={form.phone} onChange={set("phone")} autoComplete="tel" />}
            </Field>
          </div>
        </section>

        <section aria-labelledby="h-entrega" className="rounded-card border border-line bg-white p-4 sm:p-5">
          <h2 id="h-entrega" className="text-lg font-bold">2. Entrega</h2>
          <div className="mt-4 flex flex-wrap items-end gap-2">
            <Field id="c-cp" label="Código postal" required error={fieldErrors.postalCode} className="w-40">
              {(a) => <Input {...a} value={form.postalCode} onChange={set("postalCode")} inputMode="numeric" autoComplete="postal-code" maxLength={8} />}
            </Field>
            <Button type="button" variant="secondary" onClick={lookupShipping} disabled={pending}>
              {pending && !methods ? "Buscando…" : "Ver opciones de entrega"}
            </Button>
          </div>
          {methods ? (
            <fieldset className="mt-4 space-y-2" aria-describedby={fieldErrors.shippingMethodId ? "ship-err" : undefined}>
              <legend className="text-sm font-semibold">Opciones {cpChecked ? `para CP ${cpChecked}` : ""}</legend>
              {methods.map((m) => (
                <label key={m.id} className="flex cursor-pointer gap-3 rounded-2xl border-2 border-line p-3 has-[:checked]:border-blue-strong">
                  <input type="radio" name="ship" checked={methodId === m.id} onChange={() => setMethodId(m.id)} className="mt-1 h-5 w-5 accent-[#235b91]" />
                  <span className="flex-1">
                    <span className="flex justify-between gap-2 font-semibold">
                      <span>{m.name}</span>
                      <span>{m.priceCents === 0 ? "Sin costo" : formatARS(m.priceCents)}</span>
                    </span>
                    <span className="block text-xs text-ink-soft">
                      {m.description} {m.deliveryDaysMax > 0 ? `Entrega ${m.deliveryDaysMin}–${m.deliveryDaysMax} días hábiles después de la elaboración.` : ""}
                    </span>
                  </span>
                </label>
              ))}
              {fieldErrors.shippingMethodId ? <p id="ship-err" className="text-sm font-medium text-danger">{fieldErrors.shippingMethodId}</p> : null}
            </fieldset>
          ) : fieldErrors.shippingMethodId ? (
            <p className="mt-2 text-sm font-medium text-danger">Buscá las opciones de entrega con tu código postal.</p>
          ) : null}

          {selected?.kind === "delivery" ? (
            <div className="mt-4 grid gap-4 sm:grid-cols-6">
              <Field id="c-street" label="Calle" required error={fieldErrors.street} className="sm:col-span-4">
                {(a) => <Input {...a} value={form.street} onChange={set("street")} autoComplete="address-line1" />}
              </Field>
              <Field id="c-number" label="Altura" required error={fieldErrors.number} className="sm:col-span-2">
                {(a) => <Input {...a} value={form.number} onChange={set("number")} />}
              </Field>
              <Field id="c-apt" label="Piso / depto." className="sm:col-span-2">{(a) => <Input {...a} value={form.apartment} onChange={set("apartment")} autoComplete="address-line2" />}</Field>
              <Field id="c-city" label="Localidad" required error={fieldErrors.city} className="sm:col-span-2">
                {(a) => <Input {...a} value={form.city} onChange={set("city")} autoComplete="address-level2" />}
              </Field>
              <Field id="c-prov" label="Provincia" required error={fieldErrors.province} className="sm:col-span-2">
                {(a) => <Input {...a} value={form.province} onChange={set("province")} autoComplete="address-level1" />}
              </Field>
              <Field id="c-anotes" label="Indicaciones para la entrega" className="sm:col-span-6">
                {(a) => <Input {...a} value={form.addressNotes} onChange={set("addressNotes")} maxLength={200} />}
              </Field>
            </div>
          ) : null}
        </section>

        <section aria-labelledby="h-conf" className="rounded-card border border-line bg-white p-4 sm:p-5">
          <h2 id="h-conf" className="text-lg font-bold">3. Revisión</h2>
          <Field id="c-notes" label="Comentarios para el pedido" className="mt-3">
            {(a) => <Textarea {...a} value={form.notes} onChange={set("notes")} maxLength={500} rows={3} />}
          </Field>
          <label className="mt-4 flex items-start gap-2 text-sm">
            <input type="checkbox" checked={acceptTerms} onChange={(e) => setAcceptTerms(e.target.checked)} className="mt-0.5 h-5 w-5 accent-[#235b91]" aria-describedby={fieldErrors.acceptTerms ? "terms-err" : undefined} aria-invalid={!!fieldErrors.acceptTerms} />
            <span>
              Acepto los <Link href="/politicas/terminos-y-condiciones" target="_blank" className="underline">términos y condiciones</Link> y la{" "}
              <Link href="/politicas/cambios-y-devoluciones" target="_blank" className="underline">política de cambios</Link>.
            </span>
          </label>
          {fieldErrors.acceptTerms ? <p id="terms-err" className="mt-1 text-sm font-medium text-danger">{fieldErrors.acceptTerms}</p> : null}
        </section>
      </div>

      <div className="space-y-4 lg:sticky lg:top-4 lg:self-start">
        <OrderSummary summary={changed ?? summary} shippingPending={shippingPending} />
        {quoteIssues.length ? <Alert tone="error" title="Hay productos para revisar">{quoteIssues.join(" ")} <Link className="underline" href="/carrito">Ir al carrito</Link></Alert> : null}
        {message ? <Alert tone={message.tone}>{message.text}</Alert> : null}
        <Button type="submit" size="lg" className="w-full" disabled={pending || quoteIssues.length > 0}>
          {pending ? "Preparando…" : changed ? `Confirmar nuevo total (${formatARS(changed.totalCents)})` : "Continuar al pago"}
        </Button>
        <p className="text-center text-xs text-ink-soft">Todavía no se cobra nada. En el siguiente paso elegís cómo pagar.</p>
      </div>
    </form>
  );
}
