import Link from "next/link";
import Form from "next/form";
import { asc, desc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { products, productVariants } from "@/lib/db/schema";
import { requirePagePermission } from "@/lib/auth/guards";
import { formatARS } from "@/lib/money";
import { normalizeSearch } from "@/lib/catalog/queries";
import { FlashFromParams, PageHeader, Table } from "@/components/admin/ui";
import { ButtonLink, buttonClasses } from "@/components/ui/button";
import { inputClasses } from "@/components/ui/field";
import { Badge } from "@/components/ui/badge";
import { bulkFeaturedAction } from "./actions";
import { SubmitButton } from "@/components/ui/submit-button";

const STATUS: Record<string, { label: string; tone: "mint" | "yellow" | "neutral" }> = {
  published: { label: "Publicado", tone: "mint" },
  draft: { label: "Borrador", tone: "yellow" },
  archived: { label: "Archivado", tone: "neutral" },
};

export default async function AdminProducts(props: PageProps<"/admin/productos">) {
  await requirePagePermission("catalog:write");
  const sp = await props.searchParams;
  const q = typeof sp.q === "string" ? normalizeSearch(sp.q) : "";
  const status = typeof sp.estado === "string" && ["draft", "published", "archived"].includes(sp.estado) ? sp.estado : "";
  const featuredMode = sp.destacados === "1";

  const where = [];
  if (q) where.push(sql`(ck_normalize(${products.name}) LIKE ${`%${q}%`} OR lower(${products.sku}) LIKE ${`%${q}%`} OR EXISTS (SELECT 1 FROM product_variants v WHERE v.product_id = ${products.id} AND lower(v.sku) LIKE ${`%${q}%`}))`);
  if (status) where.push(eq(products.status, status as "draft"));
  if (featuredMode) where.push(eq(products.isFeatured, true));
  const rows = await db
    .select({
      p: products,
      stock: sql<number>`coalesce((SELECT sum(stock_on_hand)::int FROM ${productVariants} v WHERE v.product_id = ${products.id} AND v.is_active), 0)`,
      variants: sql<number>`(SELECT count(*)::int FROM ${productVariants} v WHERE v.product_id = ${products.id})`,
    })
    .from(products)
    .where(where.length ? sql.join(where, sql` AND `) : undefined)
    .orderBy(featuredMode ? asc(products.featuredSort) : desc(products.updatedAt))
    .limit(200);

  return (
    <div>
      <PageHeader
        title="Productos"
        description="Crear, editar, publicar y archivar. Los cambios se ven en la tienda al guardar."
        actions={
          <>
            <ButtonLink href={featuredMode ? "/admin/productos" : "/admin/productos?destacados=1"} variant="secondary">
              {featuredMode ? "Ver todos" : "Ordenar destacados"}
            </ButtonLink>
            <ButtonLink href="/admin/productos/nuevo">Nuevo producto</ButtonLink>
          </>
        }
      />
      <FlashFromParams sp={sp} />
      <Form action="/admin/productos" className="mb-4 flex flex-wrap gap-2">
        <label htmlFor="aq" className="sr-only">Buscar por nombre o SKU</label>
        <input id="aq" name="q" defaultValue={typeof sp.q === "string" ? sp.q : ""} placeholder="Nombre o SKU" className={`${inputClasses} max-w-xs`} />
        <label htmlFor="ae" className="sr-only">Estado</label>
        <select id="ae" name="estado" defaultValue={status} className={`${inputClasses} max-w-[180px]`}>
          <option value="">Todos los estados</option>
          <option value="published">Publicados</option>
          <option value="draft">Borradores</option>
          <option value="archived">Archivados</option>
        </select>
        <button className={buttonClasses("secondary")}>Filtrar</button>
      </Form>

      {featuredMode ? (
        <form action={bulkFeaturedAction}>
          <Table>
            <thead><tr><th>Producto</th><th>Destacado</th><th>Orden</th></tr></thead>
            <tbody>
              {rows.map(({ p }) => (
                <tr key={p.id}>
                  <td>{p.name}<input type="hidden" name="id" value={p.id} /></td>
                  <td><label className="flex items-center gap-2"><input type="checkbox" name={`featured_${p.id}`} defaultChecked={p.isFeatured} /> Destacado</label></td>
                  <td><label className="sr-only" htmlFor={`s-${p.id}`}>Orden</label><input id={`s-${p.id}`} name={`sort_${p.id}`} type="number" defaultValue={p.featuredSort} className="w-20 rounded-lg border-2 border-line px-2 py-1" /></td>
                </tr>
              ))}
            </tbody>
          </Table>
          <SubmitButton className="mt-3">Guardar orden de destacados</SubmitButton>
        </form>
      ) : (
        <Table>
          <thead>
            <tr><th>Producto</th><th>SKU</th><th>Precio base</th><th>Stock / cupos</th><th>Estado</th><th></th></tr>
          </thead>
          <tbody>
            {rows.map(({ p, stock, variants }) => (
              <tr key={p.id}>
                <td>
                  <Link href={`/admin/productos/${p.id}`} className="font-semibold hover:underline">{p.name}</Link>
                  <div className="text-xs text-ink-soft">{variants} variante(s){p.isFeatured ? " · Destacado" : ""}{p.isDemo ? " · Demo" : ""}</div>
                </td>
                <td className="font-mono text-xs">{p.sku}</td>
                <td>{p.isQuoteOnly ? "A presupuesto" : formatARS(p.basePriceCents)}</td>
                <td>{stock}{p.inventoryMode === "capacity" ? " cupos" : ""}</td>
                <td><Badge tone={STATUS[p.status].tone}>{STATUS[p.status].label}</Badge></td>
                <td><Link className="underline" href={`/admin/productos/${p.id}`}>Editar</Link></td>
              </tr>
            ))}
            {rows.length === 0 ? <tr><td colSpan={6} className="py-8 text-center text-ink-soft">No hay productos con esos filtros.</td></tr> : null}
          </tbody>
        </Table>
      )}
    </div>
  );
}
