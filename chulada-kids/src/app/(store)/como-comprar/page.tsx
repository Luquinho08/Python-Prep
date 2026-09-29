import type { Metadata } from "next";
import Link from "next/link";
import { getStoreSettings } from "@/lib/content/settings";

export const metadata: Metadata = { title: "Cómo comprar", alternates: { canonical: "/como-comprar" } };

export default async function HowToBuyPage() {
  const s = await getStoreSettings();
  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="text-2xl font-bold sm:text-3xl">Cómo comprar</h1>
      <ol className="mt-6 space-y-4">
        {s.howToBuy.map((step, i) => (
          <li key={step.title} className="flex gap-4 rounded-card border border-line bg-white p-5">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-yellow font-bold">{i + 1}</span>
            <div>
              <h2 className="font-semibold">{step.title}</h2>
              <p className="mt-1 text-sm text-ink-soft">{step.text}</p>
            </div>
          </li>
        ))}
      </ol>
      <section className="prose-ck mt-8 text-sm">
        <h2>Detalles importantes</h2>
        <ul>
          <li>Podés comprar como invitado; crear una cuenta es opcional.</li>
          <li>El costo de entrega se calcula con tu código postal antes de pagar.</li>
          <li>Pagás con tarjeta de crédito o débito (formulario seguro de Mercado Pago dentro de la tienda) o con tu cuenta de Mercado Pago.</li>
          <li>El pedido se confirma cuando Mercado Pago aprueba el pago. Te enviamos un email con el enlace de seguimiento.</li>
          <li>Los productos personalizados tienen un tiempo de elaboración; la entrega se suma después.</li>
        </ul>
        <p>¿Dudas? Mirá las <Link href="/preguntas-frecuentes">preguntas frecuentes</Link> o <Link href="/contacto">escribinos</Link>.</p>
      </section>
    </div>
  );
}
