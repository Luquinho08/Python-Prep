import type { Metadata } from "next";
import { getStoreSettings, whatsappLink } from "@/lib/content/settings";
import { InquiryForm } from "@/components/store/inquiry-form";

export const metadata: Metadata = { title: "Contacto", alternates: { canonical: "/contacto" } };

export default async function ContactPage() {
  const s = await getStoreSettings();
  const wa = whatsappLink(s.whatsapp);
  return (
    <div className="mx-auto grid max-w-5xl gap-8 px-4 py-8 md:grid-cols-[1fr_320px]">
      <div>
        <h1 className="text-2xl font-bold sm:text-3xl">Contacto</h1>
        <p className="mt-1 text-sm text-ink-soft">Escribinos por consultas, pedidos especiales o presupuestos.</p>
        <div className="mt-5"><InquiryForm kind="contact" /></div>
      </div>
      <aside className="h-fit rounded-card bg-surface-soft p-5 text-sm">
        <h2 className="font-semibold">Otros canales</h2>
        <ul className="mt-2 space-y-1.5">
          {s.contactEmail ? <li>Email: <a className="underline" href={`mailto:${s.contactEmail}`}>{s.contactEmail}</a></li> : null}
          {s.contactPhone ? <li>Teléfono: {s.contactPhone}</li> : null}
          {wa ? <li><a className="underline" href={wa} target="_blank" rel="noopener noreferrer">WhatsApp (ayuda)</a></li> : null}
          {s.businessHours ? <li>Horarios: {s.businessHours}</li> : null}
        </ul>
        <p className="mt-3 text-xs text-ink-soft">Las compras se hacen desde la tienda: WhatsApp es solo un canal de ayuda.</p>
      </aside>
    </div>
  );
}
