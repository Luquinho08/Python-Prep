import { asc, desc, eq, inArray } from "drizzle-orm";
import Link from "next/link";
import { db } from "@/lib/db";
import { categories, productCategories, products, productVariants, promotionCategories, promotionProducts, promotions } from "@/lib/db/schema";
import { requirePagePermission } from "@/lib/auth/guards";
import { bestPromotion, type PromotionRule } from "@/lib/pricing/engine";
import { formatARS } from "@/lib/money";
import { formatStoreDateTime, utcToStoreLocalInput } from "@/lib/time";
import { promoStatus } from "@/lib/admin/promo-status";
import { Card, FlashFromParams, PageHeader, Table } from "@/components/admin/ui";
import { inputClasses } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { Badge } from "@/components/ui/badge";
import { deletePromotionAction, savePromotionAction } from "./actions";

export default async function PromotionsAdmin(props: PageProps<"/admin/promociones">) {
  await requirePagePermission("promotions:write");
  const sp = await props.searchParams;
  const editId = typeof sp.editar === "string" ? sp.editar : null;
  const [list, prods, cats] = await Promise.all([
    db.select().from(promotions).orderBy(desc(promotions.startsAt)),
    db.select({ id: products.id, name: products.name, base: products.basePriceCents }).from(products).where(eq(products.status, "published")).orderBy(asc(products.name)),
    db.select().from(categories).orderBy(asc(categories.sort)),
  ]);
  const editing = editId ? list.find((p) => p.id === editId) ?? null : null;
  const [selProducts, selCats] = editing
    ? await Promise.all([
        db.select().from(promotionProducts).where(eq(promotionProducts.promotionId, editing.id)),
        db.select().from(promotionCategories).where(eq(promotionCategories.promotionId, editing.id)),
      ])
    : [[], []];

  // Vista previa: precio normal vs. precio con esta promoción (sin combinar con otras).
  let preview: { name: string; variant: string; regular: number; promo: number }[] = [];
  if (editing) {
    const rule: PromotionRule = {
      ...editing,
      productIds: selProducts.map((x) => x.productId),
      categoryIds: selCats.map((x) => x.categoryId),
      isActive: true,
      startsAt: new Date(0),
      endsAt: null,
    };
    const targetIds =
      editing.scope === "all" ? prods.map((p) => p.id) : editing.scope === "products" ? rule.productIds : (await db.select().from(productCategories).where(inArray(productCategories.categoryId, rule.categoryIds.length ? rule.categoryIds : ["00000000-0000-0000-0000-000000000000"]))).map((x) => x.productId);
    const ids = [...new Set(targetIds)].slice(0, 20);
    if (ids.length) {
      const rows = await db
        .select({ pid: products.id, name: products.name, base: products.basePriceCents, variant: productVariants.name, vprice: productVariants.priceCents })
        .from(productVariants)
        .innerJoin(products, eq(products.id, productVariants.productId))
        .where(inArray(products.id, ids));
      const pcs = await db.select().from(productCategories).where(inArray(productCategories.productId, ids));
      preview = rows.map((r) => {
        const regular = r.vprice ?? r.base;
        const d = bestPromotion([rule], r.pid, pcs.filter((c) => c.productId === r.pid).map((c) => c.categoryId), regular, new Date());
        return { name: r.name, variant: r.variant, regular, promo: regular - d.unitDiscountCents };
      });
    }
  }
  const e = editing;
  return (
    <div className="space-y-6">
      <PageHeader title="Promociones" description="No acumulables salvo que se marquen como acumulables. Si hay varias vigentes se aplica la de mayor ahorro. Fechas en hora de Buenos Aires." />
      <FlashFromParams sp={sp} />
      <Card title={e ? `Editar: ${e.name}` : "Nueva promoción"}>
        <form action={savePromotionAction} className="grid gap-3 md:grid-cols-3">
          {e ? <input type="hidden" name="id" value={e.id} /> : null}
          <div className="md:col-span-2"><label className="text-sm" htmlFor="pr-name">Nombre</label><input id="pr-name" name="name" defaultValue={e?.name} required className={inputClasses} /></div>
          <div><label className="text-sm" htmlFor="pr-prio">Prioridad (desempate)</label><input id="pr-prio" name="priority" type="number" defaultValue={e?.priority ?? 0} className={inputClasses} /></div>
          <div><label className="text-sm" htmlFor="pr-kind">Tipo</label>
            <select id="pr-kind" name="kind" defaultValue={e?.kind ?? "percent"} className={inputClasses}><option value="percent">Porcentaje</option><option value="fixed">Monto fijo por unidad/pack</option></select></div>
          <div><label className="text-sm" htmlFor="pr-val">Valor (% o ARS)</label><input id="pr-val" name="value" required defaultValue={e ? (e.kind === "percent" ? String(e.value / 100).replace(".", ",") : String(e.value / 100)) : ""} className={inputClasses} /></div>
          <div><label className="text-sm" htmlFor="pr-scope">Alcance</label>
            <select id="pr-scope" name="scope" defaultValue={e?.scope ?? "products"} className={inputClasses}><option value="products">Productos elegidos</option><option value="categories">Categorías elegidas</option><option value="all">Toda la tienda</option></select></div>
          <div><label className="text-sm" htmlFor="pr-start">Inicio</label><input id="pr-start" name="startsAt" type="datetime-local" required defaultValue={utcToStoreLocalInput(e?.startsAt ?? new Date())} className={inputClasses} /></div>
          <div><label className="text-sm" htmlFor="pr-end">Fin (opcional)</label><input id="pr-end" name="endsAt" type="datetime-local" defaultValue={utcToStoreLocalInput(e?.endsAt)} className={inputClasses} /></div>
          <div className="flex flex-col justify-end gap-1 text-sm">
            <label className="flex items-center gap-2"><input type="checkbox" name="isActive" defaultChecked={e ? e.isActive : true} /> Activa</label>
            <label className="flex items-center gap-2"><input type="checkbox" name="stackable" defaultChecked={e?.stackable} /> Acumulable con otras acumulables</label>
          </div>
          <fieldset className="md:col-span-3">
            <legend className="text-sm font-medium">Productos (alcance “productos”)</legend>
            <div className="mt-1 grid max-h-56 gap-1 overflow-y-auto rounded-xl border border-line p-2 sm:grid-cols-2 lg:grid-cols-3">
              {prods.map((p) => <label key={p.id} className="flex items-center gap-2 text-sm"><input type="checkbox" name="productIds" value={p.id} defaultChecked={selProducts.some((x) => x.productId === p.id)} /> {p.name}</label>)}
            </div>
          </fieldset>
          <fieldset className="md:col-span-3">
            <legend className="text-sm font-medium">Categorías (alcance “categorías”)</legend>
            <div className="mt-1 flex flex-wrap gap-2">
              {cats.map((c) => <label key={c.id} className="flex items-center gap-2 rounded-full border border-line px-3 py-1 text-sm"><input type="checkbox" name="categoryIds" value={c.id} defaultChecked={selCats.some((x) => x.categoryId === c.id)} /> {c.name}</label>)}
            </div>
          </fieldset>
          <div className="flex gap-2 md:col-span-3">
            <SubmitButton>{e ? "Guardar promoción" : "Crear promoción"}</SubmitButton>
            {e ? <Link href="/admin/promociones" className="self-center text-sm underline">Nueva</Link> : null}
          </div>
        </form>
        {e && preview.length ? (
          <div className="mt-5">
            <h3 className="font-semibold">Vista previa de precios</h3>
            <Table>
              <thead><tr><th>Producto</th><th>Variante</th><th>Normal</th><th>Con promoción</th></tr></thead>
              <tbody>{preview.map((r) => <tr key={`${r.name}-${r.variant}`}><td>{r.name}</td><td>{r.variant}</td><td>{formatARS(r.regular)}</td><td className="font-semibold">{formatARS(r.promo)}</td></tr>)}</tbody>
            </Table>
          </div>
        ) : null}
      </Card>
      <Table>
        <thead><tr><th>Promoción</th><th>Descuento</th><th>Vigencia</th><th>Estado</th><th></th></tr></thead>
        <tbody>
          {list.map((p) => {
            const st = promoStatus(p);
            return (
              <tr key={p.id}>
                <td><Link className="font-semibold underline" href={`/admin/promociones?editar=${p.id}`}>{p.name}</Link>{p.stackable ? <div className="text-xs text-ink-soft">Acumulable</div> : null}</td>
                <td>{p.kind === "percent" ? `${p.value / 100} %` : formatARS(p.value)}</td>
                <td className="text-xs">{formatStoreDateTime(p.startsAt)} → {p.endsAt ? formatStoreDateTime(p.endsAt) : "sin fin"}</td>
                <td><Badge tone={st.tone}>{st.label}</Badge></td>
                <td><form action={deletePromotionAction}><input type="hidden" name="id" value={p.id} /><button className="text-xs text-danger underline">Eliminar</button></form></td>
              </tr>
            );
          })}
        </tbody>
      </Table>
    </div>
  );
}
