"use client";
import Image from "next/image";
import Link from "next/link";
import { useActionState, useState } from "react";
import { addManyToCartAction, type CartActionState } from "@/app/actions/cart";
import { formatARS } from "@/lib/money";
import { Alert } from "../ui/alert";
import { Button } from "../ui/button";

export type ComplementItem = {
  id: string;
  slug: string;
  name: string;
  imageUrl: string | null;
  imageAlt: string;
  priceCents: number;
  regularPriceCents: number;
  priceVaries: boolean;
  minQty: number;
  quickAddVariantId: string | null;
  note: string;
};

/** "Completá tu idea": nada preseleccionado; los que requieren opciones llevan a su ficha. */
export function Complements({ items }: { items: ComplementItem[] }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [state, action, pending] = useActionState<CartActionState | null, FormData>(addManyToCartAction, null);
  const total = items.filter((i) => selected.has(i.id)).reduce((s, i) => s + i.priceCents * i.minQty, 0);

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <form action={action}>
      <ul className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {items.map((i) => (
          <li key={i.id} className="flex flex-col overflow-hidden rounded-card border border-line bg-white">
            <Link href={`/productos/${i.slug}`} className="relative block aspect-square bg-surface-soft">
              {i.imageUrl ? <Image src={i.imageUrl} alt={i.imageAlt} fill sizes="(min-width: 768px) 22vw, 45vw" className="object-cover" /> : null}
            </Link>
            <div className="flex flex-1 flex-col gap-1 p-3">
              <Link href={`/productos/${i.slug}`} className="text-sm font-semibold leading-snug hover:underline">
                {i.name}
              </Link>
              <p className="text-sm">
                {i.priceVaries ? <span className="text-xs text-ink-soft">Desde </span> : null}
                <strong>{formatARS(i.priceCents)}</strong>
                {i.regularPriceCents > i.priceCents ? <span className="ml-1 text-xs text-ink-soft line-through">{formatARS(i.regularPriceCents)}</span> : null}
              </p>
              <p className="text-xs text-ink-soft">{i.note}</p>
              <div className="mt-auto pt-2">
                {i.quickAddVariantId ? (
                  <label className="flex min-h-10 cursor-pointer items-center gap-2 rounded-full border-2 border-line px-3 text-sm font-medium has-[:checked]:border-blue-strong has-[:checked]:bg-brand-blue/15">
                    <input
                      type="checkbox"
                      name="item"
                      value={`${i.id}:${i.quickAddVariantId}`}
                      checked={selected.has(i.id)}
                      onChange={() => toggle(i.id)}
                      className="h-4 w-4 accent-[#235b91]"
                    />
                    Sumar {i.minQty > 1 ? `(${i.minQty})` : ""}
                    <input type="hidden" name={`qty_${i.id}`} value={i.minQty} />
                  </label>
                ) : (
                  <Link href={`/productos/${i.slug}`} className="flex min-h-10 items-center justify-center rounded-full border-2 border-line px-3 text-sm font-medium hover:border-ink/40">
                    Elegir opciones
                  </Link>
                )}
              </div>
            </div>
          </li>
        ))}
      </ul>
      {items.some((i) => i.quickAddVariantId) ? (
        <div className="mt-4 flex flex-col items-start gap-3 sm:flex-row sm:items-center" aria-live="polite">
          <p className="text-sm">
            {selected.size === 0 ? "Elegí los complementos que quieras sumar." : `${selected.size} seleccionado(s): ${formatARS(total)}`}
          </p>
          <Button type="submit" variant="secondary" disabled={selected.size === 0 || pending}>
            {pending ? "Agregando…" : "Agregar seleccionados al carrito"}
          </Button>
        </div>
      ) : null}
      {state ? <Alert tone={state.ok ? "success" : "error"} className="mt-3">{state.message}</Alert> : null}
    </form>
  );
}
