import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { products } from "@/lib/db/schema";
import { requirePagePermission } from "@/lib/auth/guards";
import { getComplements, getProductDetail } from "@/lib/catalog/queries";
import { sanitizeRichText } from "@/lib/content/sanitize";
import { formatARS } from "@/lib/money";
import { AVAILABILITY_LABEL } from "@/lib/inventory/availability";
import { Gallery } from "@/components/store/gallery";
import { Alert } from "@/components/ui/alert";
import { Price } from "@/components/ui/price";
import { unitNote } from "@/components/store/product-card";

/** Vista previa para el equipo: funciona también con borradores. No se indexa (layout admin). */
export default async function PreviewPage(props: PageProps<"/admin/productos/[id]/vista-previa">) {
  await requirePagePermission("catalog:write");
  const { id } = await props.params;
  const [p] = await db.select().from(products).where(eq(products.id, id));
  if (!p) notFound();
  const d = await getProductDetail(p);
  const complements = await getComplements(p.id);
  const min = d.variants.reduce((a, b) => (b.priceCents < a.priceCents ? b : a), d.variants[0]);
  return (
    <div className="space-y-6">
      <Alert tone="warning" title={`Vista previa (${p.status === "published" ? "publicado" : p.status === "draft" ? "borrador: no visible al público" : "archivado"})`}>
        <Link className="underline" href={`/admin/productos/${p.id}`}>Volver a editar</Link>
      </Alert>
      <div className="grid gap-8 rounded-card bg-white p-4 lg:grid-cols-2">
        <Gallery images={d.images} name={p.name} />
        <div>
          <h1 className="text-2xl font-bold">{p.name}</h1>
          <p className="mt-2 text-ink-soft">{p.shortDescription}</p>
          {min && !p.isQuoteOnly ? <Price className="mt-3" cents={min.priceCents} regularCents={min.regularPriceCents} from={d.variants.length > 1 || d.fields.length > 0} unitNote={unitNote(p.packUnits, p.unitLabel)} size="lg" /> : <p className="mt-3 font-semibold">A presupuesto</p>}
          <h2 className="mt-5 font-semibold">Variantes</h2>
          <ul className="mt-1 text-sm">{d.variants.map((v) => <li key={v.id}>{v.name}: {formatARS(v.priceCents)} · {AVAILABILITY_LABEL[v.availability]} ({v.available})</li>)}</ul>
          <h2 className="mt-5 font-semibold">Personalización</h2>
          <ul className="mt-1 text-sm">{d.fields.length ? d.fields.map((f) => <li key={f.key}>{f.label}{f.required ? " *" : ""} ({f.type})</li>) : <li>Sin campos</li>}</ul>
          <h2 className="mt-5 font-semibold">Complementarios que se mostrarían</h2>
          <ul className="mt-1 text-sm">{complements.length ? complements.map((c) => <li key={c.id}>{c.name}</li>) : <li>Ninguno: el bloque se oculta.</li>}</ul>
        </div>
      </div>
      {p.longDescriptionHtml ? <div className="prose-ck rounded-card bg-white p-4" dangerouslySetInnerHTML={{ __html: sanitizeRichText(p.longDescriptionHtml) }} /> : null}
    </div>
  );
}
