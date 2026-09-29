import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, eq, ne } from "drizzle-orm";
import { db } from "@/lib/db";
import { media, personalizationFields, productCategories, productImages, productRelations, products, productThemes, productVariants } from "@/lib/db/schema";
import { requirePagePermission } from "@/lib/auth/guards";
import { availableByVariant } from "@/lib/inventory/availability";
import { centsToPesosInput, formatARS } from "@/lib/money";
import { publicMediaUrl } from "@/lib/storage";
import { FlashFromParams, PageHeader, Card, Table } from "@/components/admin/ui";
import { ProductForm } from "@/components/admin/product-form";
import { inputClasses } from "@/components/ui/field";
import { buttonClasses } from "@/components/ui/button";
import { SubmitButton } from "@/components/ui/submit-button";
import { Badge } from "@/components/ui/badge";
import {
  addRelationAction,
  deleteFieldAction,
  deleteProductAction,
  deleteVariantAction,
  duplicateProductAction,
  removeImageAction,
  saveFieldAction,
  saveVariantAction,
  updateImageAction,
  updateRelationAction,
} from "../actions";

export default async function EditProductPage(props: PageProps<"/admin/productos/[id]">) {
  await requirePagePermission("catalog:write");
  const { id } = await props.params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const [p] = await db.select().from(products).where(eq(products.id, id));
  if (!p) notFound();
  const sp = await props.searchParams;

  const [cats, ths, variants, images, fields, relations, allProducts] = await Promise.all([
    db.select().from(productCategories).where(eq(productCategories.productId, id)),
    db.select().from(productThemes).where(eq(productThemes.productId, id)),
    db.select().from(productVariants).where(eq(productVariants.productId, id)).orderBy(asc(productVariants.sort)),
    db
      .select({ id: productImages.id, alt: productImages.alt, sort: productImages.sort, key: media.storageKey, isPlaceholder: media.isPlaceholder })
      .from(productImages)
      .innerJoin(media, eq(media.id, productImages.mediaId))
      .where(eq(productImages.productId, id))
      .orderBy(asc(productImages.sort)),
    db.select().from(personalizationFields).where(eq(personalizationFields.productId, id)).orderBy(asc(personalizationFields.sort)),
    db
      .select({ relatedId: productRelations.relatedProductId, sort: productRelations.sort, name: products.name, status: products.status })
      .from(productRelations)
      .innerJoin(products, eq(products.id, productRelations.relatedProductId))
      .where(eq(productRelations.productId, id))
      .orderBy(asc(productRelations.sort)),
    db.select({ id: products.id, name: products.name, status: products.status }).from(products).where(and(ne(products.id, id), ne(products.status, "archived"))).orderBy(asc(products.name)),
  ]);
  const avail = await availableByVariant(variants.map((v) => v.id));
  const hidden = (name: string, value: string) => <input type="hidden" name={name} value={value} />;

  return (
    <div className="space-y-6">
      <PageHeader
        title={p.name}
        description={
          <>
            <Badge tone={p.status === "published" ? "mint" : p.status === "draft" ? "yellow" : "neutral"}>
              {p.status === "published" ? "Publicado" : p.status === "draft" ? "Borrador" : "Archivado"}
            </Badge>{" "}
            SKU {p.sku}
          </>
        }
        actions={
          <>
            <Link href={`/admin/productos/${p.id}/vista-previa`} className={buttonClasses("secondary", "sm")}>Vista previa</Link>
            {p.status === "published" ? <Link href={`/productos/${p.slug}`} className={buttonClasses("secondary", "sm")}>Ver en la tienda</Link> : null}
            <form action={duplicateProductAction}>{hidden("id", p.id)}<SubmitButton variant="secondary" size="sm" pendingLabel="Duplicando…">Duplicar</SubmitButton></form>
          </>
        }
      />
      <FlashFromParams sp={sp} />

      <ProductForm product={p} categoryIds={cats.map((c) => c.categoryId)} primaryCategoryId={cats.find((c) => c.isPrimary)?.categoryId} themeIds={ths.map((t) => t.themeId)} />

      <Card title="Variantes" className="scroll-mt-4">
        <div id="variantes" />
        <p className="mb-3 text-sm text-ink-soft">
          Precio vacío = precio base ({formatARS(p.basePriceCents)}). {p.inventoryMode === "capacity" ? "“Stock” representa cupos de producción." : "Disponible = stock − reservas de pedidos pendientes."}
        </p>
        <div className="space-y-3">
          {variants.map((v) => (
            <div key={v.id} className="rounded-2xl border border-line p-3">
              <form action={saveVariantAction} className="grid items-end gap-2 sm:grid-cols-2 lg:grid-cols-[1.5fr_1fr_1fr_0.8fr_0.8fr_0.6fr_auto]">
                {hidden("productId", p.id)}
                {hidden("id", v.id)}
                <div><label className="text-xs" htmlFor={`vn-${v.id}`}>Nombre</label><input id={`vn-${v.id}`} name="name" defaultValue={v.name} className={inputClasses} /></div>
                <div><label className="text-xs" htmlFor={`vs-${v.id}`}>SKU</label><input id={`vs-${v.id}`} name="sku" defaultValue={v.sku} className={inputClasses} /></div>
                <div><label className="text-xs" htmlFor={`vp-${v.id}`}>Precio (ARS)</label><input id={`vp-${v.id}`} name="price" defaultValue={centsToPesosInput(v.priceCents)} placeholder="Base" className={inputClasses} /></div>
                <div><label className="text-xs" htmlFor={`vk-${v.id}`}>{p.inventoryMode === "capacity" ? "Cupos" : "Stock"}</label><input id={`vk-${v.id}`} name="stockOnHand" type="number" min={0} defaultValue={v.stockOnHand} className={inputClasses} /></div>
                <div><label className="text-xs" htmlFor={`vl-${v.id}`}>Aviso stock bajo</label><input id={`vl-${v.id}`} name="lowStockThreshold" type="number" min={0} defaultValue={v.lowStockThreshold} className={inputClasses} /></div>
                <div><label className="text-xs" htmlFor={`vo-${v.id}`}>Orden</label><input id={`vo-${v.id}`} name="sort" type="number" defaultValue={v.sort} className={inputClasses} /></div>
                <div className="flex items-center gap-2">
                  <label className="flex items-center gap-1 text-xs"><input type="checkbox" name="isActive" defaultChecked={v.isActive} /> Activa</label>
                  <SubmitButton size="sm">Guardar</SubmitButton>
                </div>
              </form>
              <div className="mt-2 flex items-center justify-between text-xs text-ink-soft">
                <span>Disponible ahora: {avail.get(v.id) ?? 0} (reservado: {v.stockOnHand - (avail.get(v.id) ?? 0)})</span>
                <form action={deleteVariantAction}>{hidden("productId", p.id)}{hidden("id", v.id)}<button className="text-danger underline">Eliminar</button></form>
              </div>
            </div>
          ))}
        </div>
        <details className="mt-4 rounded-2xl border border-dashed border-line p-3">
          <summary className="cursor-pointer text-sm font-semibold">Agregar variante</summary>
          <form action={saveVariantAction} className="mt-3 grid items-end gap-2 sm:grid-cols-2 lg:grid-cols-5">
            {hidden("productId", p.id)}
            <div><label className="text-xs" htmlFor="nv-name">Nombre</label><input id="nv-name" name="name" required className={inputClasses} /></div>
            <div><label className="text-xs" htmlFor="nv-sku">SKU</label><input id="nv-sku" name="sku" required defaultValue={`${p.sku}-${variants.length + 1}`} className={inputClasses} /></div>
            <div><label className="text-xs" htmlFor="nv-price">Precio (ARS)</label><input id="nv-price" name="price" placeholder="Base" className={inputClasses} /></div>
            <div><label className="text-xs" htmlFor="nv-stock">{p.inventoryMode === "capacity" ? "Cupos" : "Stock"}</label><input id="nv-stock" name="stockOnHand" type="number" min={0} defaultValue={0} className={inputClasses} /></div>
            <input type="hidden" name="lowStockThreshold" value="3" /><input type="hidden" name="sort" value={variants.length} />
            <SubmitButton>Agregar</SubmitButton>
          </form>
        </details>
      </Card>

      <Card title="Imágenes">
        <div id="imagenes" />
        <form action={`/api/admin/products/${p.id}/images`} method="post" encType="multipart/form-data" className="flex flex-wrap items-end gap-2">
          <div>
            <label htmlFor="img-files" className="text-sm font-medium">Subir imágenes (JPG, PNG o WEBP, hasta 10 MB c/u)</label>
            <input id="img-files" name="files" type="file" accept="image/jpeg,image/png,image/webp" multiple className="mt-1 block text-sm file:mr-3 file:rounded-full file:border-0 file:bg-brand-mint file:px-3 file:py-1.5 file:font-semibold" />
          </div>
          <button className={buttonClasses("primary", "sm")}>Subir</button>
        </form>
        <p className="mt-2 text-xs text-ink-soft">Se valida el tipo real del archivo, se quitan metadatos y se optimiza a WEBP. La primera imagen es la principal.</p>
        <ul className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {images.map((img, i) => (
            <li key={img.id} className="rounded-2xl border border-line p-3">
              <div className="relative aspect-square overflow-hidden rounded-xl bg-surface-soft">
                <Image src={publicMediaUrl(img.key) ?? ""} alt={img.alt} fill sizes="300px" className="object-cover" />
                {i === 0 ? <span className="absolute left-2 top-2"><Badge tone="yellow">Principal</Badge></span> : null}
                {img.isPlaceholder ? <span className="absolute right-2 top-2"><Badge>Demo</Badge></span> : null}
              </div>
              <form action={updateImageAction} className="mt-2 space-y-2">
                {hidden("productId", p.id)}
                {hidden("id", img.id)}
                <label className="text-xs" htmlFor={`alt-${img.id}`}>Texto alternativo</label>
                <input id={`alt-${img.id}`} name="alt" defaultValue={img.alt} className={inputClasses} />
                <div className="flex flex-wrap gap-1">
                  <SubmitButton size="sm" variant="secondary">Guardar texto</SubmitButton>
                  <button name="move" value="up" disabled={i === 0} className={buttonClasses("ghost", "sm")} aria-label="Mover antes">↑</button>
                  <button name="move" value="down" disabled={i === images.length - 1} className={buttonClasses("ghost", "sm")} aria-label="Mover después">↓</button>
                </div>
              </form>
              <form action={removeImageAction} className="mt-1">{hidden("productId", p.id)}{hidden("id", img.id)}<button className="text-xs text-danger underline">Quitar imagen</button></form>
            </li>
          ))}
        </ul>
      </Card>

      <Card title="Personalización">
        <p className="mb-3 text-sm text-ink-soft">Los recargos se definen acá y el servidor los aplica; el cliente no puede modificarlos.</p>
        {fields.length ? (
          <Table>
            <thead><tr><th>Campo</th><th>Tipo</th><th>Obligatorio</th><th>Recargo</th><th></th></tr></thead>
            <tbody>
              {fields.map((f) => (
                <tr key={f.id}>
                  <td>{f.label} <span className="font-mono text-xs text-ink-soft">({f.key})</span>{f.options.length ? <div className="text-xs text-ink-soft">{f.options.map((o) => o.label).join(", ")}</div> : null}</td>
                  <td>{f.type}{f.maxLength ? ` · máx ${f.maxLength}` : ""}{f.minLeadDays != null ? ` · ${f.minLeadDays} días anticipación` : ""}</td>
                  <td>{f.required ? "Sí" : "No"}</td>
                  <td>{f.surchargeCents ? formatARS(f.surchargeCents) : "—"}</td>
                  <td><form action={deleteFieldAction}>{hidden("productId", p.id)}{hidden("id", f.id)}<button className="text-xs text-danger underline">Eliminar</button></form></td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : <p className="text-sm">Sin campos de personalización.</p>}
        <details className="mt-4 rounded-2xl border border-dashed border-line p-3">
          <summary className="cursor-pointer text-sm font-semibold">Agregar campo</summary>
          <form action={saveFieldAction} className="mt-3 grid gap-3 md:grid-cols-3">
            {hidden("productId", p.id)}
            <div><label className="text-xs" htmlFor="nf-label">Etiqueta *</label><input id="nf-label" name="label" required className={inputClasses} /></div>
            <div><label className="text-xs" htmlFor="nf-key">Clave (opcional)</label><input id="nf-key" name="key" placeholder="nombre" className={inputClasses} /></div>
            <div>
              <label className="text-xs" htmlFor="nf-type">Tipo</label>
              <select id="nf-type" name="type" className={inputClasses}>
                <option value="text">Texto corto</option>
                <option value="textarea">Texto largo / observaciones</option>
                <option value="select">Selección (color, temática, acabado)</option>
                <option value="date">Fecha del evento</option>
                <option value="file">Archivo de referencia</option>
              </select>
            </div>
            <div><label className="text-xs" htmlFor="nf-max">Máx. caracteres</label><input id="nf-max" name="maxLength" type="number" className={inputClasses} /></div>
            <div><label className="text-xs" htmlFor="nf-lead">Días de anticipación (fecha)</label><input id="nf-lead" name="minLeadDays" type="number" className={inputClasses} /></div>
            <div><label className="text-xs" htmlFor="nf-sur">Recargo (ARS)</label><input id="nf-sur" name="surcharge" className={inputClasses} /></div>
            <div className="md:col-span-2"><label className="text-xs" htmlFor="nf-opts">Opciones (una por línea: valor|Etiqueta|recargo)</label><textarea id="nf-opts" name="options" rows={3} className={inputClasses} placeholder={"rosa|Rosa\nbrillo|Brillante|1200"} /></div>
            <div><label className="text-xs" htmlFor="nf-help">Ayuda</label><input id="nf-help" name="helpText" className={inputClasses} /></div>
            <div className="flex flex-wrap items-center gap-3 text-sm md:col-span-3">
              <label className="flex items-center gap-2"><input type="checkbox" name="required" /> Obligatorio</label>
              <label className="flex items-center gap-2"><input type="checkbox" name="acceptPdf" /> Archivo: aceptar PDF</label>
              <label className="flex items-center gap-2">Máx. MB <input name="maxFileMb" type="number" min={1} max={8} defaultValue={8} className="w-16 rounded-lg border-2 border-line px-2" /></label>
              <input type="hidden" name="sort" value={fields.length + 1} />
              <SubmitButton>Agregar campo</SubmitButton>
            </div>
          </form>
        </details>
      </Card>

      <Card title="Completá tu idea (complementarios manuales)">
        <div id="complementarios" />
        <p className="mb-3 text-sm text-ink-soft">
          Relación direccional: se muestran en la ficha de este producto. Tienen prioridad sobre las reglas automáticas (Admin → Complementarios). Solo se muestran si están publicados y disponibles.
        </p>
        {relations.length ? (
          <ol className="space-y-2">
            {relations.map((r, i) => (
              <li key={r.relatedId} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line px-3 py-2 text-sm">
                <span>{i + 1}. {r.name} {r.status !== "published" ? <Badge tone="yellow">No publicado: no se muestra</Badge> : null}</span>
                <form action={updateRelationAction} className="flex gap-1">
                  {hidden("productId", p.id)}
                  {hidden("relatedId", r.relatedId)}
                  <button name="op" value="up" disabled={i === 0} className={buttonClasses("ghost", "sm")} aria-label={`Subir ${r.name}`}>↑</button>
                  <button name="op" value="down" disabled={i === relations.length - 1} className={buttonClasses("ghost", "sm")} aria-label={`Bajar ${r.name}`}>↓</button>
                  <button name="op" value="remove" className={buttonClasses("danger", "sm")}>Quitar</button>
                </form>
              </li>
            ))}
          </ol>
        ) : <p className="text-sm">Sin asociaciones manuales.</p>}
        <form action={addRelationAction} className="mt-4 flex flex-wrap items-end gap-2">
          {hidden("productId", p.id)}
          <div className="min-w-64 flex-1">
            <label htmlFor="rel" className="text-sm font-medium">Buscar y asociar producto</label>
            <select id="rel" name="relatedId" className={inputClasses} required defaultValue="">
              <option value="" disabled>Elegí un producto…</option>
              {allProducts.filter((x) => !relations.some((r) => r.relatedId === x.id)).map((x) => (
                <option key={x.id} value={x.id}>{x.name}{x.status !== "published" ? " (borrador)" : ""}</option>
              ))}
            </select>
          </div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="reciprocal" /> Recíproca</label>
          <SubmitButton>Asociar</SubmitButton>
        </form>
      </Card>

      <Card title="Zona de riesgo">
        <form action={deleteProductAction} className="flex flex-wrap items-center gap-3">
          {hidden("id", p.id)}
          <p className="text-sm text-ink-soft">Si el producto tiene pedidos, se archiva en lugar de eliminarse para preservar el historial.</p>
          <SubmitButton variant="danger" size="sm" pendingLabel="Procesando…">Eliminar producto</SubmitButton>
        </form>
      </Card>
    </div>
  );
}
