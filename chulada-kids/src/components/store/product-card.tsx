import Image from "next/image";
import Link from "next/link";
import type { ProductCardData } from "@/lib/catalog/queries";
import { AVAILABILITY_LABEL } from "@/lib/inventory/availability";
import { Badge } from "../ui/badge";
import { Price } from "../ui/price";

export function unitNote(packUnits: number, unitLabel: string) {
  return packUnits > 1 ? `Pack de ${packUnits} ${unitLabel}` : `Precio por ${unitLabel}`;
}

export function ProductCard({ product, priority = false }: { product: ProductCardData; priority?: boolean }) {
  const out = product.availability === "out";
  return (
    <article className="group relative flex h-full flex-col overflow-hidden rounded-card border border-line bg-white shadow-soft transition-shadow hover:shadow-md">
      <div className="relative aspect-square bg-surface-soft">
        {product.image ? (
          <Image
            src={product.image.url}
            alt={product.image.alt}
            fill
            sizes="(min-width: 1280px) 280px, (min-width: 768px) 30vw, 48vw"
            className={out ? "object-cover opacity-60" : "object-cover"}
            priority={priority}
          />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-ink-soft">Sin imagen</div>
        )}
        <div className="absolute left-2 top-2 flex flex-wrap gap-1">
          {product.promotions.length > 0 && !out ? <Badge tone="coral">Promo</Badge> : null}
          {product.personalizable ? <Badge tone="lavender">Personalizable</Badge> : null}
        </div>
      </div>
      <div className="flex flex-1 flex-col gap-1.5 p-3 sm:p-4">
        <h3 className="text-sm font-semibold leading-snug sm:text-base">
          <Link href={`/productos/${product.slug}`} className="after:absolute after:inset-0 focus-visible:outline-none">
            {product.name}
          </Link>
        </h3>
        {product.isQuoteOnly ? (
          <p className="text-sm font-semibold">Precio a presupuesto</p>
        ) : (
          <Price
            cents={product.priceCents}
            regularCents={product.regularPriceCents}
            from={product.priceVaries}
            unitNote={unitNote(product.packUnits, product.unitLabel)}
            size="sm"
          />
        )}
        <p className={out ? "mt-auto text-xs font-semibold text-danger" : "mt-auto text-xs text-ink-soft"}>
          {product.isQuoteOnly ? "Consultá disponibilidad" : AVAILABILITY_LABEL[product.availability]}
        </p>
      </div>
      <span className="pointer-events-none absolute inset-0 rounded-card ring-blue-strong group-focus-within:ring-3" aria-hidden="true" />
    </article>
  );
}

export function ProductGrid({ products, priorityCount = 0 }: { products: ProductCardData[]; priorityCount?: number }) {
  return (
    <ul className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-4">
      {products.map((p, i) => (
        <li key={p.id}>
          <ProductCard product={p} priority={i < priorityCount} />
        </li>
      ))}
    </ul>
  );
}
