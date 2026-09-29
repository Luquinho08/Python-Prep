import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { env } from "@/lib/env";
import { simulateChallengeAction } from "@/app/actions/simulator";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = { title: "Simulador 3DS", robots: { index: false } };

export default async function Sim3dsPage(props: PageProps<"/checkout/simulador-3ds">) {
  if (env.paymentsDriver !== "fake") notFound();
  const sp = await props.searchParams;
  return (
    <div className="mx-auto max-w-md px-4 py-8">
      <div className="rounded-card border-2 border-dashed border-danger/60 p-5">
        <p className="text-sm font-bold text-danger">SIMULADOR LOCAL — verificación del banco (3DS)</p>
        {sp.listo ? <p className="mt-3 font-semibold" role="status">Verificación completada. La tienda continúa automáticamente.</p> : null}
        <form action={simulateChallengeAction} className="mt-4 grid gap-2" hidden={!!sp.listo}>
          <input type="hidden" name="order" value={typeof sp.order === "string" ? sp.order : ""} />
          <Button name="ok" value="1">Verificación correcta</Button>
          <Button name="ok" value="0" variant="secondary">Verificación fallida</Button>
        </form>
      </div>
    </div>
  );
}
