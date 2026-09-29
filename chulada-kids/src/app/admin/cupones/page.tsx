import { desc, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { coupons } from "@/lib/db/schema";
import { requirePagePermission } from "@/lib/auth/guards";
import { formatARS, centsToPesosInput } from "@/lib/money";
import { formatStoreDateTime, utcToStoreLocalInput } from "@/lib/time";
import { promoStatus } from "@/lib/admin/promo-status";
import { Card, FlashFromParams, PageHeader } from "@/components/admin/ui";
import { inputClasses } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { Badge } from "@/components/ui/badge";
import { saveCouponAction } from "../promociones/actions";

export default async function CouponsAdmin(props: PageProps<"/admin/cupones">) {
  await requirePagePermission("promotions:write");
  const rows = await db
    .select({
      c: coupons,
      used: sql<number>`(SELECT count(*)::int FROM coupon_redemptions r WHERE r.coupon_id = ${coupons.id} AND r.status = 'used')`,
      reserved: sql<number>`(SELECT count(*)::int FROM coupon_redemptions r WHERE r.coupon_id = ${coupons.id} AND r.status = 'reserved' AND r.reserved_until > now())`,
    })
    .from(coupons)
    .orderBy(desc(coupons.createdAt));
  const form = (c?: (typeof rows)[number]["c"]) => (
    <form action={saveCouponAction} className="grid gap-3 md:grid-cols-4">
      {c ? <input type="hidden" name="id" value={c.id} /> : null}
      <div><label className="text-xs" htmlFor={`cc-${c?.id ?? "n"}`}>Código</label><input id={`cc-${c?.id ?? "n"}`} name="code" defaultValue={c?.code} required className={inputClasses} /></div>
      <div><label className="text-xs" htmlFor={`ck-${c?.id ?? "n"}`}>Tipo</label><select id={`ck-${c?.id ?? "n"}`} name="kind" defaultValue={c?.kind ?? "percent"} className={inputClasses}><option value="percent">Porcentaje</option><option value="fixed">Monto fijo</option></select></div>
      <div><label className="text-xs" htmlFor={`cv-${c?.id ?? "n"}`}>Valor (% o ARS)</label><input id={`cv-${c?.id ?? "n"}`} name="value" required defaultValue={c ? (c.kind === "percent" ? String(c.value / 100) : centsToPesosInput(c.value)) : ""} className={inputClasses} /></div>
      <div><label className="text-xs" htmlFor={`cm-${c?.id ?? "n"}`}>Compra mínima (ARS)</label><input id={`cm-${c?.id ?? "n"}`} name="minSubtotal" defaultValue={c ? centsToPesosInput(c.minSubtotalCents) : ""} className={inputClasses} /></div>
      <div className="md:col-span-2"><label className="text-xs" htmlFor={`cd-${c?.id ?? "n"}`}>Condiciones visibles</label><input id={`cd-${c?.id ?? "n"}`} name="description" defaultValue={c?.description} className={inputClasses} /></div>
      <div><label className="text-xs" htmlFor={`cs-${c?.id ?? "n"}`}>Desde</label><input id={`cs-${c?.id ?? "n"}`} name="startsAt" type="datetime-local" defaultValue={utcToStoreLocalInput(c?.startsAt)} className={inputClasses} /></div>
      <div><label className="text-xs" htmlFor={`ce-${c?.id ?? "n"}`}>Vence</label><input id={`ce-${c?.id ?? "n"}`} name="endsAt" type="datetime-local" defaultValue={utcToStoreLocalInput(c?.endsAt)} className={inputClasses} /></div>
      <div><label className="text-xs" htmlFor={`cu-${c?.id ?? "n"}`}>Usos totales</label><input id={`cu-${c?.id ?? "n"}`} name="maxUses" type="number" min={1} defaultValue={c?.maxUses ?? ""} className={inputClasses} /></div>
      <div><label className="text-xs" htmlFor={`cp-${c?.id ?? "n"}`}>Usos por comprador</label><input id={`cp-${c?.id ?? "n"}`} name="maxUsesPerCustomer" type="number" min={1} defaultValue={c?.maxUsesPerCustomer ?? ""} className={inputClasses} /></div>
      <div className="flex flex-col justify-end gap-1 text-sm md:col-span-2">
        <label className="flex items-center gap-2"><input type="checkbox" name="combinable" defaultChecked={c?.combinableWithPromotions} /> Combinable con productos en promoción</label>
        <label className="flex items-center gap-2"><input type="checkbox" name="isActive" defaultChecked={c ? c.isActive : true} /> Activo</label>
      </div>
      <div className="md:col-span-4"><SubmitButton size="sm">{c ? "Guardar" : "Crear cupón"}</SubmitButton></div>
    </form>
  );
  return (
    <div className="space-y-4">
      <PageHeader
        title="Cupones"
        description="El límite por comprador se controla por cuenta o email. Un email de invitado no prueba una identidad única: alguien puede usar otro email. Los usos se reservan al crear el pedido y se liberan si el pago no se concreta."
      />
      <FlashFromParams sp={await props.searchParams} />
      <Card title="Nuevo cupón">{form()}</Card>
      {rows.map(({ c, used, reserved }) => {
        const st = promoStatus({ isActive: c.isActive, startsAt: c.startsAt, endsAt: c.endsAt });
        return (
          <Card key={c.id} title={<span className="flex flex-wrap items-center gap-2 font-mono">{c.code} <Badge tone={st.tone}>{st.label}</Badge><span className="font-sans text-xs font-normal text-ink-soft">Usados: {used} · Reservados: {reserved}{c.maxUses ? ` · Límite ${c.maxUses}` : ""} · {c.kind === "percent" ? `${c.value / 100} %` : formatARS(c.value)}{c.endsAt ? ` · vence ${formatStoreDateTime(c.endsAt)}` : ""}</span></span>}>
            {form(c)}
          </Card>
        );
      })}
    </div>
  );
}
