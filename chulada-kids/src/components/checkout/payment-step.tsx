"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CardPayment, initMercadoPago, Wallet } from "@mercadopago/sdk-react";
import { Alert } from "../ui/alert";
import { Button } from "../ui/button";
import { formatARS } from "@/lib/money";

type Outcome = { status: string; message: string; challengeUrl: string | null; attemptId: string };
type Props = {
  orderId: string;
  orderNumber: string;
  accessToken: string;
  totalCents: number;
  email: string;
  driver: "mercadopago" | "fake";
  publicKey: string | null;
  cardEnabled: boolean;
  walletEnabled: boolean;
};

function newKey() {
  return crypto.randomUUID();
}

export function PaymentStep(p: Props) {
  const router = useRouter();
  const [method, setMethod] = useState<"card" | "wallet" | null>(p.cardEnabled ? "card" : p.walletEnabled ? "wallet" : null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [preferenceId, setPreferenceId] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  // Una clave por intento: los reintentos de red reusan la misma (no duplican el cobro).
  const keyRef = useRef<string>("");
  const storageKey = `ck_pay_key_${p.orderId}`;

  useEffect(() => {
    try {
      keyRef.current = sessionStorage.getItem(storageKey) ?? newKey();
      sessionStorage.setItem(storageKey, keyRef.current);
    } catch {
      keyRef.current = newKey();
    }
    const on = () => setOffline(false);
    const off = () => setOffline(true);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, [storageKey]);

  // Idempotente: solo registra la Public Key; el SDK se carga cuando se monta un Brick.
  if (p.driver === "mercadopago" && p.publicKey) initMercadoPago(p.publicKey, { locale: "es-AR" });

  const resultUrl = (attemptId?: string) => `/checkout/resultado?pedido=${p.orderId}&t=${encodeURIComponent(p.accessToken)}${attemptId ? `&intento=${attemptId}` : ""}`;

  const rotateKey = () => {
    keyRef.current = newKey();
    try {
      sessionStorage.setItem(storageKey, keyRef.current);
    } catch {
      /* sin almacenamiento: la clave vive en memoria */
    }
  };

  const postCard = useCallback(
    async (payload: Record<string, unknown>) => {
      setBusy(true);
      setError(null);
      let res: Response | null = null;
      // Reintento automático ante corte de red, con la MISMA clave de idempotencia.
      for (let i = 0; i < 3 && !res; i++) {
        try {
          res = await fetch(`/api/checkout/${p.orderId}/card`, {
            method: "POST",
            headers: { "content-type": "application/json", "x-idempotency-key": keyRef.current, "x-order-token": p.accessToken },
            body: JSON.stringify(payload),
          });
        } catch {
          await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
        }
      }
      setBusy(false);
      if (!res) {
        setError("Se interrumpió la conexión. No vuelvas a pagar: revisá el estado del pedido.");
        router.push(resultUrl());
        return;
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        setError(data.error ?? "No pudimos procesar el pago.");
        if (data.code === "already_paid") router.push(resultUrl());
        if (data.code === "reservation_expired" || data.code === "amount_changed") setTimeout(() => router.refresh(), 100);
        throw new Error(data.error);
      }
      const out = data as Outcome;
      setOutcome(out);
      if (out.status === "approved" || out.status === "pending" || out.status === "to_verify") {
        router.push(resultUrl(out.attemptId));
      } else if (out.status === "rejected" || out.status === "cancelled") {
        rotateKey(); // un nuevo intento controlado necesita una clave nueva
        throw new Error(out.message);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [p.orderId, p.accessToken],
  );

  const initialization = useMemo(() => ({ amount: p.totalCents / 100, payer: { email: p.email } }), [p.totalCents, p.email]);
  const customization = useMemo(() => ({ paymentMethods: { maxInstallments: 12 }, visual: { style: { theme: "default" } } }), []);
  const onSubmit = useCallback(
    async (formData: Record<string, unknown>, additional?: { paymentTypeId?: string }) =>
      postCard({ ...formData, paymentTypeId: additional?.paymentTypeId ?? (formData as { payment_type_id?: string }).payment_type_id ?? "credit_card" }),
    [postCard],
  );
  const onError = useCallback(() => setError("El formulario de pago de Mercado Pago no pudo cargarse. Revisá tu conexión o elegí otro medio."), []);

  async function startWallet() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/checkout/${p.orderId}/wallet`, {
        method: "POST",
        headers: { "x-idempotency-key": keyRef.current, "x-order-token": p.accessToken },
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error ?? "No pudimos iniciar el pago.");
      setPreferenceId(data.preferenceId);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!p.cardEnabled && !p.walletEnabled) {
    return <Alert tone="warning" title="Pagos no disponibles">Mercado Pago todavía no está conectado. No se puede cobrar este pedido por ahora.</Alert>;
  }

  return (
    <section aria-labelledby="h-metodo" className="space-y-4">
      <h2 id="h-metodo" className="text-xl font-bold">Método de pago</h2>
      {offline ? <Alert tone="warning">Sin conexión a internet. Esperá a recuperarla antes de pagar.</Alert> : null}
      <fieldset className="space-y-3">
        <legend className="sr-only">Elegí cómo pagar</legend>
        {p.cardEnabled ? (
          <label className="flex cursor-pointer gap-3 rounded-card border-2 border-line bg-white p-4 has-[:checked]:border-blue-strong">
            <input type="radio" name="method" checked={method === "card"} onChange={() => setMethod("card")} className="mt-1 h-5 w-5 accent-[#235b91]" />
            <span>
              <span className="block font-semibold">Tarjeta de crédito o débito — procesado por Mercado Pago</span>
              <span className="block text-sm text-ink-soft">Completás los datos acá mismo, en un formulario seguro de Mercado Pago. Tu banco puede pedirte una verificación adicional.</span>
            </span>
          </label>
        ) : null}
        {p.walletEnabled ? (
          <label className="flex cursor-pointer gap-3 rounded-card border-2 border-line bg-white p-4 has-[:checked]:border-blue-strong">
            <input type="radio" name="method" checked={method === "wallet"} onChange={() => setMethod("wallet")} className="mt-1 h-5 w-5 accent-[#235b91]" />
            <span>
              <span className="block font-semibold">Pagar con mi cuenta de Mercado Pago</span>
              <span className="block text-sm text-ink-soft">Vas a ir al sitio de Mercado Pago para ingresar y confirmar. Al terminar (o si cancelás) volvés a Chulada Kids con el mismo pedido.</span>
            </span>
          </label>
        ) : null}
      </fieldset>

      {error ? <Alert tone="error">{error}</Alert> : null}
      {outcome?.status === "requires_action" && outcome.challengeUrl ? (
        <div className="space-y-2 rounded-card border border-line bg-white p-4">
          <p className="font-semibold">Verificación de tu banco</p>
          <p className="text-sm text-ink-soft">Completá la verificación para terminar el pago. No cierres esta página.</p>
          <iframe title="Verificación del banco emisor" src={outcome.challengeUrl} className="h-[480px] w-full rounded-xl border border-line" />
          <Button variant="secondary" onClick={() => router.push(resultUrl(outcome.attemptId))}>Ya completé la verificación</Button>
        </div>
      ) : null}

      {method === "card" && p.cardEnabled ? (
        <div className="rounded-card border border-line bg-white p-3 sm:p-4">
          <p className="mb-2 text-sm">Total a cobrar: <strong>{formatARS(p.totalCents)}</strong>. Las cuotas y su costo los informa Mercado Pago en el formulario.</p>
          {p.driver === "mercadopago" ? (
            <>
              <CardPayment initialization={initialization} customization={customization as never} onSubmit={onSubmit as never} onError={onError} locale="es-AR" />
              <p className="mt-2 text-xs text-ink-soft">El botón de pago pertenece al formulario seguro de Mercado Pago y es la única acción que realiza el cobro.</p>
            </>
          ) : (
            <FakeCardForm busy={busy} totalCents={p.totalCents} onPay={(scenario) => postCard({ token: `fake:${scenario}`, payment_method_id: "visa", paymentTypeId: "credit_card", installments: 1, transaction_amount: p.totalCents / 100, payer: { email: p.email } }).catch(() => null)} />
          )}
        </div>
      ) : null}

      {method === "wallet" && p.walletEnabled ? (
        <div className="rounded-card border border-line bg-white p-4">
          {!preferenceId ? (
            <Button onClick={startWallet} disabled={busy} size="lg" className="w-full sm:w-auto">{busy ? "Preparando…" : "Continuar con Mercado Pago"}</Button>
          ) : p.driver === "mercadopago" ? (
            <Wallet initialization={{ preferenceId, redirectMode: "self" }} locale="es-AR" />
          ) : (
            <a href={`/checkout/simulador-mp?pref=${encodeURIComponent(preferenceId)}`} className="inline-flex min-h-12 items-center rounded-full bg-brand-blue px-6 font-semibold">
              Ir al simulador de Mercado Pago (entorno local)
            </a>
          )}
        </div>
      ) : null}
    </section>
  );
}

function FakeCardForm({ onPay, busy, totalCents }: { onPay: (s: string) => void; busy: boolean; totalCents: number }) {
  const [scenario, setScenario] = useState("approve");
  return (
    <div className="space-y-3 rounded-2xl border-2 border-dashed border-danger/50 bg-brand-coral/10 p-4">
      <p className="text-sm font-bold text-danger">SIMULADOR LOCAL — NO ES MERCADO PAGO. No se procesan tarjetas reales ni se cobra dinero.</p>
      <p className="text-xs text-ink-soft">En producción este lugar lo ocupa el Card Payment Brick oficial. Acá se elige el resultado que devolvería el proveedor para probar el flujo completo.</p>
      <label className="block text-sm font-medium" htmlFor="fake-scenario">Resultado a simular</label>
      <select id="fake-scenario" value={scenario} onChange={(e) => setScenario(e.target.value)} className="block w-full rounded-xl border-2 border-line px-3 py-2">
        <option value="approve">Aprobado</option>
        <option value="reject">Rechazado (fondos insuficientes)</option>
        <option value="pending">Pendiente de revisión</option>
        <option value="challenge">Requiere verificación del banco (3DS)</option>
        <option value="timeout">Sin respuesta (timeout)</option>
      </select>
      <Button size="lg" className="w-full" disabled={busy} onClick={() => onPay(scenario)}>
        {busy ? "Procesando…" : `Comprar · ${formatARS(totalCents)}`}
      </Button>
    </div>
  );
}
