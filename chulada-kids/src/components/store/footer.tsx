import Link from "next/link";
import { asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { pages } from "@/lib/db/schema";
import { getStoreSettings, whatsappLink } from "@/lib/content/settings";
import { Rainbow } from "../ui/decor";

export async function Footer() {
  const [settings, policyPages] = await Promise.all([
    getStoreSettings(),
    db.select({ slug: pages.slug, title: pages.title }).from(pages).where(eq(pages.showInFooter, true)).orderBy(asc(pages.title)),
  ]);
  const wa = whatsappLink(settings.whatsapp);
  return (
    <footer className="mt-16 border-t border-line bg-surface-soft">
      <div className="mx-auto grid max-w-7xl gap-8 px-4 py-10 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <Rainbow className="h-8 w-14" />
          <p className="mt-2 font-semibold">{settings.storeName}</p>
          <p className="text-sm text-ink-soft">{settings.tagline}</p>
        </div>
        <div>
          <h2 className="text-sm font-semibold">Ayuda</h2>
          <ul className="mt-2 space-y-1.5 text-sm">
            <li><Link className="hover:underline" href="/como-comprar">Cómo comprar</Link></li>
            <li><Link className="hover:underline" href="/preguntas-frecuentes">Preguntas frecuentes</Link></li>
            <li><Link className="hover:underline" href="/contacto">Contacto</Link></li>
            <li><Link className="hover:underline" href="/pedido">Consultar mi pedido</Link></li>
          </ul>
        </div>
        <div>
          <h2 className="text-sm font-semibold">Políticas</h2>
          <ul className="mt-2 space-y-1.5 text-sm">
            {policyPages.map((p) => (
              <li key={p.slug}>
                <Link className="hover:underline" href={`/politicas/${p.slug}`}>{p.title}</Link>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h2 className="text-sm font-semibold">Contacto</h2>
          <ul className="mt-2 space-y-1.5 text-sm text-ink-soft">
            {settings.contactEmail ? <li><a className="hover:underline" href={`mailto:${settings.contactEmail}`}>{settings.contactEmail}</a></li> : null}
            {settings.contactPhone ? <li>{settings.contactPhone}</li> : null}
            {wa ? <li><a className="hover:underline" href={wa} rel="noopener noreferrer" target="_blank">WhatsApp (ayuda)</a></li> : null}
            {settings.instagram ? <li><a className="hover:underline" href={settings.instagram} rel="noopener noreferrer" target="_blank">Instagram</a></li> : null}
            {settings.businessHours ? <li>{settings.businessHours}</li> : null}
          </ul>
        </div>
      </div>
      <p className="border-t border-line px-4 py-4 text-center text-xs text-ink-soft">
        © {new Date().getFullYear()} {settings.storeName}. Pagos procesados por Mercado Pago.
      </p>
    </footer>
  );
}
