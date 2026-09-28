import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getComplements, getPublicProduct } from "@/lib/catalog/queries";
import { getStoreSettings, checkoutReadinessProblems } from "@/lib/content/settings";
import { sanitizeRichText } from "@/lib/content/sanitize";
import { addDaysToDateString, storeToday } from "@/lib/time";
import { formatARS } from "@/lib/money";
import { AVAILABILITY_LABEL } from "@/lib/inventory/availability";
import { recordEvent } from "@/lib/analytics";
import { env } from "@/lib/env";
import { Gallery } from "@/components/store/gallery";
import { ProductConfigurator } from "@/components/store/product-configurator";
import { Complements } from "@/components/store/complements";
import { InquiryForm } from "@/components/store/inquiry-form";
import { unitNote } from "@/components/store/product-card";
import { Badge } from "@/components/ui/badge";
import { Price } from "@/components/ui/price";
import { Alert } from "@/components/ui/alert";

export async function generateMetadata(props: PageProps<"/productos/[slug]">): Promise<Metadata> {
  const d = await getPublicProduct((await props.params).slug);
  if (!d) return { title: "Producto no encontrado" };
  const p = d.product;
  return {
    title: p.seoTitle || p.name,
    description: p.seoDescription || p.shortDescription,
    alternates: { canonical: `/productos/${p.slug}` },
    openGraph: { title: p.name, description: p.shortDescription, images: d.images[0] ? [d.images[0].url] : [] },
  };
}

export default async function ProductPage(props: PageProps<"/productos/[slug]">) {
  const { slug } = await props.params;
  const detail = await getPublicProduct(slug);
  if (!detail) notFound();
  const { product: p, variants, images, categories, themes, fields } = detail;
  const [settings, complements] = await Promise.all([getStoreSettings(), getComplements(p.id)]);
  await recordEvent("view_product", { productId: p.id });

  const today = storeToday();
  const prices = variants.map((v) => v.priceCents);
  const minVariant = variants.reduce((a, b) => (b.priceCents < a.priceCents ? b : a), variants[0]);
  const priceVaries = new Set(prices).size > 1 || fields.some((f) => f.surchargeCents > 0 || f.options.some((o) => (o.surchargeCents ?? 0) > 0));
  const totalAvailable = variants.reduce((s, v) => s + v.available, 0);
  const buyableCheckout = checkoutReadinessProblems(settings).length === 0;

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: p.name,
    description: p.shortDescription,
    sku: p.sku,
    image: images.map((i) => `${env.appUrl}${i.url}`),
    ...(p.isQuoteOnly || !minVariant
      ? {}
      : {
          offers: {
            "@type": "AggregateOffer",
            priceCurrency: "ARS",
            lowPrice: (Math.min(...prices) / 100).toFixed(2),
            highPrice: (Math.max(...prices) / 100).toFixed(2),
            availability: totalAvailable > 0 ? "https://schema.org/InStock" : "https://schema.org/OutOfStock",
          },
        }),
  };

  return (
    <div className="mx-auto max-w-7xl px-4 py-6">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />
      <nav aria-label="Ruta" className="text-xs text-ink-soft">
        <Link href="/" className="hover:underline">Inicio</Link> <span aria-hidden="true">/</span>{" "}
        {categories[0] ? (
          <>
            <Link href={`/categorias/${categories[0].slug}`} className="hover:underline">{categories[0].name}</Link> <span aria-hidden="true">/</span>{" "}
          </>
        ) : null}
        <span>{p.name}</span>
      </nav>

      <div className="mt-4 grid gap-8 lg:grid-cols-2">
        <Gallery images={images} name={p.name} />
        <div>
          <div className="flex flex-wrap gap-1.5">
            {fields.length ? <Badge tone="lavender">Personalizable</Badge> : null}
            {variants.some((v) => v.promotions.length) ? <Badge tone="coral">Promo</Badge> : null}
            {themes.map((t) => (
              <Link key={t.id} href={`/productos?tematica=${t.slug}`}><Badge tone="mint">{t.name}</Badge></Link>
            ))}
          </div>
          <h1 className="mt-2 text-2xl font-bold sm:text-3xl">{p.name}</h1>
          <p className="mt-2 text-ink-soft">{p.shortDescription}</p>

          {p.isQuoteOnly ? (
            <div className="mt-6 space-y-4">
              <Alert tone="info" title="Producto a presupuesto">
                El precio depende de las piezas y cantidades, por eso no se compra online. Envianos tu consulta y te respondemos con un presupuesto.
              </Alert>
              <InquiryForm kind="quote" productId={p.id} defaultMessage={`Hola, quiero un presupuesto para "${p.name}".`} />
            </div>
          ) : (
            <>
              <div className="mt-4">
                {minVariant ? (
                  <Price cents={minVariant.priceCents} regularCents={minVariant.regularPriceCents} from={priceVaries} unitNote={unitNote(p.packUnits, p.unitLabel)} size="lg" />
                ) : null}
                {minVariant?.promotions.length ? (
                  <p className="mt-1 text-sm">
                    Promoción vigente: <strong>{minVariant.promotions.map((x) => x.name).join(" + ")}</strong> (ahorrás {formatARS(minVariant.regularPriceCents - minVariant.priceCents)} por {p.packUnits > 1 ? "pack" : p.unitLabel}).
                  </p>
                ) : null}
                <p className="mt-1 text-sm text-ink-soft">
                  {p.inventoryMode === "capacity" ? "A pedido" : AVAILABILITY_LABEL[variants.find((v) => v.available > 0)?.availability ?? "out"]}
                  {p.productionDaysMax > 0 ? ` · Elaboración: ${p.productionDaysMin}–${p.productionDaysMax} días hábiles (antes del envío)` : ""}
                </p>
              </div>
              {!buyableCheckout ? (
                <Alert tone="warning" className="mt-4" title="Compra online en configuración">
                  Podés armar tu carrito; el pago se habilita cuando la tienda complete su configuración.
                </Alert>
              ) : null}
              <div className="mt-6">
                <ProductConfigurator
                  productId={p.id}
                  variants={variants.map((v) => ({ id: v.id, name: v.name, priceCents: v.priceCents, regularPriceCents: v.regularPriceCents, available: v.available, availability: v.availability }))}
                  fields={fields.map((f) => ({
                    key: f.key,
                    label: f.label,
                    type: f.type,
                    required: f.required,
                    maxLength: f.maxLength,
                    options: f.options,
                    surchargeCents: f.surchargeCents,
                    helpText: f.helpText,
                    minDate: f.type === "date" ? addDaysToDateString(today, f.minLeadDays ?? 0) : null,
                    acceptMime: f.acceptMime,
                    maxFileMb: f.maxFileMb,
                  }))}
                  minQty={p.minQty}
                  qtyStep={p.qtyStep}
                  maxQty={p.maxQty}
                  packUnits={p.packUnits}
                  unitLabel={p.unitLabel}
                  allowBackorder={p.allowBackorder}
                  checkoutEnabled={buyableCheckout}
                />
              </div>
              {fields.length ? <p className="mt-3 text-xs text-ink-soft">No mostramos una vista previa del diseño: {p.requiresDesignApproval ? "te enviamos una prueba para aprobar antes de producir." : "revisamos tus datos antes de producir."}</p> : null}
            </>
          )}

          <dl className="mt-8 divide-y divide-line rounded-card border border-line text-sm">
            {[
              ["Contenido", p.packContents],
              ["Materiales", p.materials],
              ["Medidas", p.dimensions],
              ["Elaboración", p.productionDaysMax > 0 ? `${p.productionDaysMin} a ${p.productionDaysMax} días hábiles desde la confirmación del pago${p.requiresDesignApproval ? " y la aprobación del diseño" : ""}.` : "Listo para preparar."],
              ["Entrega", p.deliveryNotes],
            ]
              .filter(([, v]) => v)
              .map(([k, v]) => (
                <div key={k} className="grid grid-cols-3 gap-2 px-4 py-3">
                  <dt className="font-semibold">{k}</dt>
                  <dd className="col-span-2 text-ink-soft">{v}</dd>
                </div>
              ))}
          </dl>
        </div>
      </div>

      {p.longDescriptionHtml ? (
        <section aria-labelledby="h-desc" className="mt-10 max-w-3xl">
          <h2 id="h-desc" className="text-xl font-bold">Descripción</h2>
          <div className="prose-ck mt-3" dangerouslySetInnerHTML={{ __html: sanitizeRichText(p.longDescriptionHtml) }} />
        </section>
      ) : null}

      {complements.length > 0 ? (
        <section aria-labelledby="h-comp" className="mt-12">
          <h2 id="h-comp" className="text-xl font-bold sm:text-2xl">Completá tu idea</h2>
          <p className="mt-1 text-sm text-ink-soft">Productos que combinan con este. Son opcionales: no se agregan ni se cobran si no los elegís.</p>
          <div className="mt-4">
            <Complements
              items={complements.map((c) => ({
                id: c.id,
                slug: c.slug,
                name: c.name,
                imageUrl: c.image?.url ?? null,
                imageAlt: c.image?.alt ?? c.name,
                priceCents: c.priceCents,
                regularPriceCents: c.regularPriceCents,
                priceVaries: c.priceVaries,
                minQty: c.minQty,
                quickAddVariantId: c.quickAddVariantId,
                note: c.quickAddVariantId ? unitNote(c.packUnits, c.unitLabel) : c.requiresPersonalization ? "Requiere personalización" : "Tiene opciones para elegir",
              }))}
            />
          </div>
        </section>
      ) : null}
    </div>
  );
}
