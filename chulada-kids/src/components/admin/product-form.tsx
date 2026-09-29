import { asc } from "drizzle-orm";
import { db } from "@/lib/db";
import { categories, themes, type products } from "@/lib/db/schema";
import { centsToPesosInput } from "@/lib/money";
import { htmlToPlainText } from "@/lib/content/sanitize";
import { saveProductAction } from "@/app/admin/productos/actions";
import { inputClasses } from "../ui/field";
import { SubmitButton } from "../ui/submit-button";
import { Card } from "./ui";

type P = typeof products.$inferSelect;

function F({ label, name, children, hint, className = "" }: { label: string; name: string; children?: React.ReactNode; hint?: string; className?: string }) {
  return (
    <div className={className}>
      <label htmlFor={`pf-${name}`} className="block text-sm font-medium">{label}</label>
      <div className="mt-1">{children}</div>
      {hint ? <p className="mt-1 text-xs text-ink-soft">{hint}</p> : null}
    </div>
  );
}

export async function ProductForm({ product, categoryIds = [], primaryCategoryId, themeIds = [] }: { product?: P; categoryIds?: string[]; primaryCategoryId?: string; themeIds?: string[] }) {
  const [cats, ths] = await Promise.all([
    db.select().from(categories).orderBy(asc(categories.sort)),
    db.select().from(themes).orderBy(asc(themes.sort)),
  ]);
  const p = product;
  const input = (name: string, value: string | number | null | undefined, extra: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <input id={`pf-${name}`} name={name} defaultValue={value ?? ""} className={inputClasses} {...extra} />
  );
  return (
    <form action={saveProductAction} className="space-y-4">
      {p ? <input type="hidden" name="id" value={p.id} /> : null}
      <Card title="Datos básicos">
        <div className="grid gap-4 md:grid-cols-2">
          <F label="Nombre *" name="name">{input("name", p?.name, { required: true, maxLength: 120 })}</F>
          <F label="SKU *" name="sku" hint="Código único interno.">{input("sku", p?.sku, { required: true, maxLength: 40 })}</F>
          <F label="Slug (URL)" name="slug" hint="Se genera desde el nombre si lo dejás vacío.">{input("slug", p?.slug, { maxLength: 120 })}</F>
          <F label="Estado" name="status" hint="Para publicar se requiere variante activa, imagen con texto alternativo, categoría y precio.">
            <select id="pf-status" name="status" defaultValue={p?.status ?? "draft"} className={inputClasses} disabled={!p}>
              <option value="draft">Borrador (no visible)</option>
              <option value="published">Publicado</option>
              <option value="archived">Archivado</option>
            </select>
          </F>
          <F label="Descripción breve" name="shortDescription" className="md:col-span-2">{input("shortDescription", p?.shortDescription, { maxLength: 240 })}</F>
          <F label="Descripción larga" name="longDescription" className="md:col-span-2" hint="Texto simple; dejá una línea en blanco entre párrafos. No se admite HTML ni scripts.">
            <textarea id="pf-longDescription" name="longDescription" rows={5} defaultValue={p ? htmlToPlainText(p.longDescriptionHtml) : ""} className={inputClasses} />
          </F>
        </div>
      </Card>

      <Card title="Precio, packs y cantidades">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <F label="Precio base (ARS) *" name="basePrice" hint="Por pack/unidad vendida. Las variantes pueden tener precio propio.">{input("basePrice", centsToPesosInput(p?.basePriceCents ?? null), { inputMode: "decimal", required: true })}</F>
          <F label="Unidades por pack" name="packUnits">{input("packUnits", p?.packUnits ?? 1, { type: "number", min: 1 })}</F>
          <F label="Nombre de la unidad" name="unitLabel" hint="Ej.: etiquetas, invitaciones, caja.">{input("unitLabel", p?.unitLabel ?? "unidad")}</F>
          <F label="Peso (g)" name="weightGrams">{input("weightGrams", p?.weightGrams, { type: "number", min: 0 })}</F>
          <F label="Cantidad mínima" name="minQty">{input("minQty", p?.minQty ?? 1, { type: "number", min: 1 })}</F>
          <F label="Paso de cantidad" name="qtyStep">{input("qtyStep", p?.qtyStep ?? 1, { type: "number", min: 1 })}</F>
          <F label="Cantidad máxima" name="maxQty" hint="Vacío = sin máximo.">{input("maxQty", p?.maxQty, { type: "number", min: 1 })}</F>
        </div>
        <label className="mt-4 flex items-center gap-2 text-sm"><input type="checkbox" name="isQuoteOnly" defaultChecked={p?.isQuoteOnly} /> Producto a presupuesto (no se compra online; muestra formulario de consulta)</label>
      </Card>

      <Card title="Inventario y elaboración">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <F label="Modo" name="inventoryMode" hint="Cupos: productos a pedido con capacidad limitada.">
            <select id="pf-inventoryMode" name="inventoryMode" defaultValue={p?.inventoryMode ?? "stock"} className={inputClasses}>
              <option value="stock">Stock físico</option>
              <option value="capacity">A pedido (cupos de producción)</option>
            </select>
          </F>
          <F label="Elaboración mín. (días hábiles)" name="productionDaysMin">{input("productionDaysMin", p?.productionDaysMin ?? 0, { type: "number", min: 0 })}</F>
          <F label="Elaboración máx. (días hábiles)" name="productionDaysMax">{input("productionDaysMax", p?.productionDaysMax ?? 0, { type: "number", min: 0 })}</F>
        </div>
        <div className="mt-4 flex flex-wrap gap-4 text-sm">
          <label className="flex items-center gap-2"><input type="checkbox" name="allowBackorder" defaultChecked={p?.allowBackorder} /> Permitir encargos sin disponibilidad</label>
          <label className="flex items-center gap-2"><input type="checkbox" name="requiresDesignApproval" defaultChecked={p?.requiresDesignApproval} /> Requiere aprobación de diseño</label>
        </div>
      </Card>

      <Card title="Categorías, temáticas y etiquetas">
        <fieldset>
          <legend className="text-sm font-medium">Categorías (la marcada como principal define la ruta)</legend>
          <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {cats.map((c) => (
              <div key={c.id} className="flex items-center justify-between gap-2 rounded-xl border border-line px-3 py-2 text-sm">
                <label className="flex items-center gap-2"><input type="checkbox" name="categoryIds" value={c.id} defaultChecked={categoryIds.includes(c.id)} /> {c.name}</label>
                <label className="flex items-center gap-1 text-xs text-ink-soft"><input type="radio" name="primaryCategoryId" value={c.id} defaultChecked={primaryCategoryId === c.id} /> principal</label>
              </div>
            ))}
          </div>
        </fieldset>
        <fieldset className="mt-4">
          <legend className="text-sm font-medium">Temáticas / ocasiones</legend>
          <div className="mt-2 flex flex-wrap gap-2">
            {ths.map((t) => (
              <label key={t.id} className="flex items-center gap-2 rounded-full border border-line px-3 py-1.5 text-sm"><input type="checkbox" name="themeIds" value={t.id} defaultChecked={themeIds.includes(t.id)} /> {t.name}</label>
            ))}
          </div>
        </fieldset>
        <F label="Etiquetas (separadas por coma)" name="tags" className="mt-4" hint="Se usan en la búsqueda y en complementarios automáticos.">{input("tags", p?.tags.join(", "))}</F>
        <div className="mt-4 flex flex-wrap items-end gap-4">
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="isFeatured" defaultChecked={p?.isFeatured} /> Destacado en el inicio</label>
          <F label="Orden de destacado" name="featuredSort">{input("featuredSort", p?.featuredSort ?? 0, { type: "number", className: `${inputClasses} w-28` })}</F>
        </div>
      </Card>

      <Card title="Detalles de la ficha">
        <div className="grid gap-4 md:grid-cols-2">
          <F label="Contenido del pack" name="packContents">{input("packContents", p?.packContents)}</F>
          <F label="Materiales" name="materials">{input("materials", p?.materials)}</F>
          <F label="Medidas" name="dimensions">{input("dimensions", p?.dimensions)}</F>
          <F label="Opciones de entrega" name="deliveryNotes">{input("deliveryNotes", p?.deliveryNotes)}</F>
        </div>
      </Card>

      <Card title="SEO">
        <div className="grid gap-4 md:grid-cols-2">
          <F label="Título SEO" name="seoTitle" hint="Hasta 70 caracteres. Vacío = nombre.">{input("seoTitle", p?.seoTitle, { maxLength: 70 })}</F>
          <F label="Descripción SEO" name="seoDescription" hint="Hasta 170 caracteres. Vacío = descripción breve.">{input("seoDescription", p?.seoDescription, { maxLength: 170 })}</F>
        </div>
      </Card>

      <div className="sticky bottom-0 z-10 -mx-4 border-t border-line bg-white/95 px-4 py-3 backdrop-blur">
        <SubmitButton size="lg">{p ? "Guardar cambios" : "Crear producto"}</SubmitButton>
      </div>
    </form>
  );
}
