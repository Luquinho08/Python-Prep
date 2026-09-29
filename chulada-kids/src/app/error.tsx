"use client";

export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main id="contenido" className="mx-auto flex max-w-lg flex-1 flex-col items-center justify-center px-4 py-16 text-center">
      <h1 className="text-2xl font-bold">Algo salió mal</h1>
      <p className="mt-2 text-ink-soft">
        No pudimos cargar esta página. Si estabas pagando, no reintentes el pago: revisá el estado del pedido desde el enlace del email o desde tu cuenta.
      </p>
      <button onClick={reset} className="mt-6 rounded-full bg-brand-blue px-5 py-2.5 font-semibold">
        Reintentar
      </button>
    </main>
  );
}
