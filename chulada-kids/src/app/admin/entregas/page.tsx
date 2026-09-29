import { asc } from "drizzle-orm";
import { db } from "@/lib/db";
import { shippingMethods } from "@/lib/db/schema";
import { requirePagePermission } from "@/lib/auth/guards";
import { centsToPesosInput } from "@/lib/money";
import { Card, FlashFromParams, PageHeader } from "@/components/admin/ui";
import { inputClasses } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { saveShippingAction } from "./actions";

export default async function ShippingAdmin(props: PageProps<"/admin/entregas">) {
  await requirePagePermission("shipping:write");
  const rows = await db.select().from(shippingMethods).orderBy(asc(shippingMethods.sort));
  const form = (m?: (typeof rows)[number]) => {
    const k = m?.id ?? "new";
    return (
      <form action={saveShippingAction} className="grid gap-3 md:grid-cols-4">
        {m ? <input type="hidden" name="id" value={m.id} /> : null}
        <div className="md:col-span-2"><label className="text-xs" htmlFor={`sn-${k}`}>Nombre visible</label><input id={`sn-${k}`} name="name" defaultValue={m?.name} required className={inputClasses} /></div>
        <div><label className="text-xs" htmlFor={`sk-${k}`}>Tipo</label><select id={`sk-${k}`} name="kind" defaultValue={m?.kind ?? "delivery"} className={inputClasses}><option value="pickup">Retiro</option><option value="delivery">Envío</option></select></div>
        <div><label className="text-xs" htmlFor={`sp-${k}`}>Costo (ARS)</label><input id={`sp-${k}`} name="price" defaultValue={centsToPesosInput(m?.priceCents ?? 0)} className={inputClasses} /></div>
        <div className="md:col-span-2"><label className="text-xs" htmlFor={`sc-${k}`}>Códigos postales (envío)</label><input id={`sc-${k}`} name="postalCodes" defaultValue={m?.postalCodes.join(", ")} placeholder="1000-1499, 1602" className={inputClasses} /></div>
        <div><label className="text-xs" htmlFor={`s1-${k}`}>Entrega mín. (días hábiles)</label><input id={`s1-${k}`} name="deliveryDaysMin" type="number" min={0} defaultValue={m?.deliveryDaysMin ?? 0} className={inputClasses} /></div>
        <div><label className="text-xs" htmlFor={`s2-${k}`}>Entrega máx. (días hábiles)</label><input id={`s2-${k}`} name="deliveryDaysMax" type="number" min={0} defaultValue={m?.deliveryDaysMax ?? 0} className={inputClasses} /></div>
        <div className="md:col-span-3"><label className="text-xs" htmlFor={`sd-${k}`}>Descripción / instrucciones</label><input id={`sd-${k}`} name="description" defaultValue={m?.description} className={inputClasses} /></div>
        <div><label className="text-xs" htmlFor={`so-${k}`}>Orden</label><input id={`so-${k}`} name="sort" type="number" defaultValue={m?.sort ?? 0} className={inputClasses} /></div>
        <div className="flex items-center gap-4 md:col-span-4">
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="isActive" defaultChecked={m ? m.isActive : true} /> Activo</label>
          <SubmitButton size="sm">{m ? "Guardar" : "Agregar"}</SubmitButton>
        </div>
      </form>
    );
  };
  return (
    <div className="space-y-4">
      <PageHeader
        title="Entregas"
        description="El costo se conoce antes del pago. Si el código postal del cliente no tiene cobertura, solo se ofrecen los métodos de retiro; sin ninguno, no se puede cobrar. El plazo de entrega se suma al de elaboración."
      />
      <FlashFromParams sp={await props.searchParams} />
      <Card title="Nuevo método">{form()}</Card>
      {rows.map((m) => <Card key={m.id} title={m.name}>{form(m)}</Card>)}
    </div>
  );
}
