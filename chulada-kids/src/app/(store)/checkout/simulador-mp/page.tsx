import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { env } from "@/lib/env";
import { simulatePreferenceAction } from "@/app/actions/simulator";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = { title: "Simulador local de Mercado Pago", robots: { index: false } };

export default async function SimulatorPage(props: PageProps<"/checkout/simulador-mp">) {
  if (env.paymentsDriver !== "fake") notFound();
  const sp = await props.searchParams;
  const pref = typeof sp.pref === "string" ? sp.pref : "";
  return (
    <div className="mx-auto max-w-lg px-4 py-10">
      <div className="rounded-card border-2 border-dashed border-danger/60 bg-brand-coral/10 p-6">
        <p className="text-sm font-bold text-danger">SIMULADOR LOCAL — NO ES MERCADO PAGO</p>
        <h1 className="mt-2 text-xl font-bold">Pagar con cuenta (simulado)</h1>
        <p className="mt-1 text-sm text-ink-soft">Reemplaza el entorno de Mercado Pago solo en desarrollo. Elegí el resultado.</p>
        <form action={simulatePreferenceAction} className="mt-5 grid gap-2">
          <input type="hidden" name="pref" value={pref} />
          <Button name="outcome" value="approved">Aprobar pago</Button>
          <Button name="outcome" value="pending" variant="secondary">Dejar pendiente (p. ej. pago en efectivo)</Button>
          <Button name="outcome" value="rejected" variant="secondary">Rechazar</Button>
          <Button name="outcome" value="cancel" variant="ghost">Cancelar y volver a la tienda</Button>
        </form>
      </div>
    </div>
  );
}
