import type { Metadata } from "next";
import Link from "next/link";
import { OrderLookupForm } from "@/components/store/order-lookup-form";

export const metadata: Metadata = { title: "Consultar mi pedido", robots: { index: false } };

export default function OrderLookupPage() {
  return (
    <div className="mx-auto max-w-md px-4 py-10">
      <h1 className="text-2xl font-bold">Consultar mi pedido</h1>
      <p className="mt-1 text-sm text-ink-soft">
        Si compraste como invitado, te reenviamos el enlace personal al email de la compra. Si tenés cuenta, <Link className="underline" href="/cuenta">ingresá</Link>.
      </p>
      <div className="mt-5">
        <OrderLookupForm />
      </div>
    </div>
  );
}
