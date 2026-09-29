import { asc, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { categories, themes } from "@/lib/db/schema";
import { deleteTaxonomyAction, saveTaxonomyAction } from "@/app/admin/categorias/actions";
import { inputClasses } from "../ui/field";
import { SubmitButton } from "../ui/submit-button";
import { Card, FlashFromParams, PageHeader } from "./ui";

export async function TaxonomyPage({ kind, sp }: { kind: "category" | "theme"; sp: Record<string, string | string[] | undefined> }) {
  const table = kind === "theme" ? themes : categories;
  const join = kind === "theme" ? sql`(SELECT count(*)::int FROM product_themes x WHERE x.theme_id = ${table.id})` : sql`(SELECT count(*)::int FROM product_categories x WHERE x.category_id = ${table.id})`;
  const rows = await db.select({ t: table, n: sql<number>`${join}` }).from(table).orderBy(asc(table.sort), asc(table.name));
  const label = kind === "theme" ? "temática" : "categoría";
  const row = (r?: (typeof rows)[number]) => (
    <form action={saveTaxonomyAction} className="grid items-end gap-2 md:grid-cols-[1.2fr_1fr_2fr_80px_auto_auto]">
      <input type="hidden" name="kind" value={kind} />
      {r ? <input type="hidden" name="id" value={r.t.id} /> : null}
      <div><label className="text-xs" htmlFor={`n-${r?.t.id ?? "new"}`}>Nombre</label><input id={`n-${r?.t.id ?? "new"}`} name="name" defaultValue={r?.t.name} required className={inputClasses} /></div>
      <div><label className="text-xs" htmlFor={`s-${r?.t.id ?? "new"}`}>Slug</label><input id={`s-${r?.t.id ?? "new"}`} name="slug" defaultValue={r?.t.slug} className={inputClasses} /></div>
      <div><label className="text-xs" htmlFor={`d-${r?.t.id ?? "new"}`}>Descripción</label><input id={`d-${r?.t.id ?? "new"}`} name="description" defaultValue={r?.t.description} className={inputClasses} /></div>
      <div><label className="text-xs" htmlFor={`o-${r?.t.id ?? "new"}`}>Orden</label><input id={`o-${r?.t.id ?? "new"}`} name="sort" type="number" defaultValue={r?.t.sort ?? 0} className={inputClasses} /></div>
      <label className="flex items-center gap-1 pb-3 text-xs"><input type="checkbox" name="isActive" defaultChecked={r ? r.t.isActive : true} /> Activa</label>
      <SubmitButton size="sm">{r ? "Guardar" : "Agregar"}</SubmitButton>
    </form>
  );
  return (
    <div>
      <PageHeader title={kind === "theme" ? "Temáticas y ocasiones" : "Categorías"} description={kind === "theme" ? "Se usan como filtro, en el inicio y para complementarios automáticos." : "Organizan el menú y el catálogo."} />
      <FlashFromParams sp={sp} />
      <Card title={`Nueva ${label}`}>{row()}</Card>
      <div className="mt-4 space-y-3">
        {rows.map((r) => (
          <Card key={r.t.id}>
            {row(r)}
            <div className="mt-2 flex items-center justify-between text-xs text-ink-soft">
              <span>{r.n} producto(s)</span>
              <form action={deleteTaxonomyAction}><input type="hidden" name="kind" value={kind} /><input type="hidden" name="id" value={r.t.id} /><button className="text-danger underline">Eliminar</button></form>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
