import Image from "next/image";
import { requirePagePermission } from "@/lib/auth/guards";
import { getBranding } from "@/lib/content/branding";
import { checkoutReadinessProblems } from "@/lib/content/settings";
import { Card, FlashFromParams, PageHeader } from "@/components/admin/ui";
import { inputClasses } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { buttonClasses } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { saveSettingsAction } from "./actions";

export default async function SettingsAdmin(props: PageProps<"/admin/configuracion">) {
  await requirePagePermission("settings:write");
  const { settings: s, logo } = await getBranding();
  const problems = checkoutReadinessProblems(s);
  const f = (name: keyof typeof s, label: string, hint?: string) => (
    <div>
      <label className="text-sm" htmlFor={`cfg-${name}`}>{label}</label>
      <input id={`cfg-${name}`} name={name} defaultValue={String(s[name] ?? "")} className={inputClasses} />
      {hint ? <p className="mt-1 text-xs text-ink-soft">{hint}</p> : null}
    </div>
  );
  return (
    <div className="space-y-6">
      <PageHeader title="Configuración" description="Datos comerciales, logo y habilitación de la compra." />
      <FlashFromParams sp={await props.searchParams} />
      {problems.length ? <Alert tone="warning" title="La compra está deshabilitada">{problems.join(" ")}</Alert> : <Alert tone="success">La compra online está habilitada.</Alert>}
      <Card title="Logo">
        <div className="flex flex-wrap items-center gap-4">
          {logo ? <Image src={logo.url} alt="Logo actual" width={logo.width} height={logo.height} className="h-16 w-auto" /> : <Alert tone="warning">Sin logo cargado: se muestra una marca tipográfica provisional.</Alert>}
          <form action="/api/admin/upload" method="post" encType="multipart/form-data" className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="target" value="logo" /><input type="hidden" name="back" value="/admin/configuracion" /><input type="hidden" name="alt" value="Chulada Kids" />
            <label htmlFor="logo-file" className="text-sm">Subir logo (PNG/JPG/WEBP; se conservan proporciones)</label>
            <input id="logo-file" name="file" type="file" accept="image/png,image/jpeg,image/webp" className="text-sm" />
            <button className={buttonClasses("secondary", "sm")}>Subir</button>
          </form>
        </div>
      </Card>
      <form action={saveSettingsAction} className="space-y-4">
        <Card title="Datos del comercio">
          <div className="grid gap-3 md:grid-cols-2">
            {f("storeName", "Nombre de la tienda")}
            {f("tagline", "Bajada")}
            {f("contactEmail", "Email de contacto *", "Obligatorio para habilitar la compra.")}
            {f("contactPhone", "Teléfono")}
            {f("whatsapp", "WhatsApp (canal de ayuda secundario)", "Solo números con código de país, ej.: 5491122334455.")}
            {f("businessHours", "Horarios de atención")}
            {f("pickupAddress", "Dirección de retiro", "Se muestra solo a quien elige retiro y paga.")}
            {f("instagram", "Instagram (https://…)")}
            {f("facebook", "Facebook (https://…)")}
            {f("tiktok", "TikTok (https://…)")}
            {f("legalName", "Razón social (pendiente del propietario)")}
            {f("taxId", "CUIT (pendiente del propietario)")}
          </div>
        </Card>
        <Card title="Compra y visibilidad">
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="checkoutEnabled" defaultChecked={s.checkoutEnabled} /> Habilitar compra online (requiere Mercado Pago conectado para cobrar)</label>
          <label className="mt-2 flex items-center gap-2 text-sm"><input type="checkbox" name="noindexSite" defaultChecked={s.noindexSite} /> Pedir a buscadores que no indexen la tienda (recomendado mientras sea demo)</label>
        </Card>
        <SubmitButton size="lg">Guardar configuración</SubmitButton>
      </form>
    </div>
  );
}
