import Link from "next/link";
import { getBranding } from "@/lib/content/branding";
import { listActiveCategories } from "@/lib/catalog/queries";
import { getCartCount } from "@/lib/cart/service";
import { getCurrentUser } from "@/lib/auth/session";
import { isStaff } from "@/lib/auth/permissions";
import { Logo } from "./logo";
import { SearchBox } from "./search-box";

function CartIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M3 4h2l2.2 10.2a2 2 0 0 0 2 1.6h7.6a2 2 0 0 0 2-1.5L21 8H6.2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="10" cy="20" r="1.4" />
      <circle cx="17" cy="20" r="1.4" />
    </svg>
  );
}

function UserIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.8">
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6" strokeLinecap="round" />
    </svg>
  );
}

export async function Header() {
  const [{ settings, logo }, categories, count, user] = await Promise.all([
    getBranding(),
    listActiveCategories(),
    getCartCount(),
    getCurrentUser(),
  ]);
  const showAnnouncement = settings.announcementEnabled && settings.announcementText && settings.homeSections.includes("announcement");
  return (
    <header className="border-b border-line bg-white">
      <a href="#contenido" className="skip-link rounded-full bg-ink px-4 py-2 text-sm font-semibold text-white">
        Saltar al contenido
      </a>
      {showAnnouncement ? (
        <p className="bg-brand-mint px-4 py-1.5 text-center text-xs font-medium sm:text-sm">{settings.announcementText}</p>
      ) : null}
      <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-3 sm:gap-6">
        <Logo logoUrl={logo?.url} logoWidth={logo?.width} logoHeight={logo?.height} storeName={settings.storeName} />
        <div className="hidden flex-1 md:block">
          <SearchBox />
        </div>
        <nav aria-label="Cuenta y carrito" className="ml-auto flex items-center gap-1 md:ml-0">
          {user && isStaff(user.role) ? (
            <Link href="/admin" className="hidden rounded-full px-3 py-2 text-sm font-medium hover:bg-ink/5 sm:inline-flex">
              Panel
            </Link>
          ) : null}
          <Link href="/cuenta" className="flex items-center gap-1.5 rounded-full px-2.5 py-2 text-sm font-medium hover:bg-ink/5">
            <UserIcon />
            <span className="hidden sm:inline">{user ? "Mi cuenta" : "Ingresar"}</span>
            <span className="sr-only sm:hidden">{user ? "Mi cuenta" : "Ingresar"}</span>
          </Link>
          <Link href="/carrito" className="relative flex items-center gap-1.5 rounded-full px-2.5 py-2 text-sm font-medium hover:bg-ink/5">
            <CartIcon />
            <span className="hidden sm:inline">Carrito</span>
            <span
              className="absolute -right-0.5 -top-0.5 min-w-5 rounded-full bg-brand-coral px-1 text-center text-xs font-bold leading-5 text-ink sm:static sm:bg-brand-yellow"
              aria-label={`${count} ${count === 1 ? "producto" : "productos"} en el carrito`}
            >
              {count}
            </span>
          </Link>
        </nav>
      </div>
      <div className="px-4 pb-3 md:hidden">
        <SearchBox />
      </div>
      <nav aria-label="Categorías" className="border-t border-line">
        <ul className="mx-auto flex max-w-7xl gap-1 overflow-x-auto px-3 py-2 text-sm [scrollbar-width:none]">
          <li>
            <Link href="/productos" className="block whitespace-nowrap rounded-full px-3 py-1.5 font-medium hover:bg-brand-mint/60">
              Todo
            </Link>
          </li>
          {categories.map((c) => (
            <li key={c.id}>
              <Link href={`/categorias/${c.slug}`} className="block whitespace-nowrap rounded-full px-3 py-1.5 hover:bg-brand-mint/60">
                {c.name}
              </Link>
            </li>
          ))}
          <li>
            <Link href="/promociones" className="block whitespace-nowrap rounded-full px-3 py-1.5 hover:bg-brand-coral/40">
              Promociones
            </Link>
          </li>
        </ul>
      </nav>
    </header>
  );
}
