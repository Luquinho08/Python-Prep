import Link from "next/link";
import { Star } from "@/components/ui/decor";

export default function NotFound() {
  return (
    <main id="contenido" className="mx-auto flex max-w-lg flex-1 flex-col items-center justify-center px-4 py-16 text-center">
      <Star className="h-12 w-12 text-brand-yellow" />
      <h1 className="mt-3 text-2xl font-bold">No encontramos esta página</h1>
      <p className="mt-2 text-ink-soft">Puede que el producto ya no esté disponible o que el enlace tenga un error.</p>
      <div className="mt-6 flex gap-2">
        <Link href="/" className="rounded-full bg-brand-blue px-5 py-2.5 font-semibold">Ir al inicio</Link>
        <Link href="/productos" className="rounded-full border-2 border-ink/15 px-5 py-2.5 font-semibold">Ver productos</Link>
      </div>
    </main>
  );
}
