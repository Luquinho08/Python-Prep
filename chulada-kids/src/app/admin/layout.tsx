import type { Metadata } from "next";
import Link from "next/link";
import { requireStaffPage } from "@/lib/auth/guards";
import { can, ROLE_LABELS, type Permission } from "@/lib/auth/permissions";
import { logoutAction } from "@/app/actions/auth";
import { AdminNav } from "@/components/admin/nav";

export const metadata: Metadata = { title: { default: "Panel", template: "%s · Panel Chulada Kids" }, robots: { index: false, follow: false } };

const NAV: { href: string; label: string; perm: Permission }[] = [
  { href: "/admin", label: "Resumen", perm: "dashboard:read" },
  { href: "/admin/pedidos", label: "Pedidos", perm: "orders:read" },
  { href: "/admin/productos", label: "Productos", perm: "catalog:write" },
  { href: "/admin/categorias", label: "Categorías", perm: "catalog:write" },
  { href: "/admin/tematicas", label: "Temáticas", perm: "catalog:write" },
  { href: "/admin/complementarios", label: "Complementarios", perm: "catalog:write" },
  { href: "/admin/promociones", label: "Promociones", perm: "promotions:write" },
  { href: "/admin/cupones", label: "Cupones", perm: "promotions:write" },
  { href: "/admin/clientes", label: "Clientes y consultas", perm: "customers:read" },
  { href: "/admin/contenido", label: "Contenido", perm: "content:write" },
  { href: "/admin/entregas", label: "Entregas", perm: "shipping:write" },
  { href: "/admin/pagos", label: "Medios de pago", perm: "payments:manage" },
  { href: "/admin/equipo", label: "Equipo", perm: "team:manage" },
  { href: "/admin/configuracion", label: "Configuración", perm: "settings:write" },
];

export default async function AdminLayout({ children }: LayoutProps<"/admin">) {
  const user = await requireStaffPage();
  const items = NAV.filter((n) => can(user.role, n.perm)).map(({ href, label }) => ({ href, label }));
  return (
    <div className="min-h-full bg-surface-soft">
      <header className="border-b border-line bg-white">
        <div className="mx-auto flex max-w-[1400px] flex-wrap items-center justify-between gap-2 px-4 py-3">
          <Link href="/admin" className="font-bold">Chulada Kids · Panel</Link>
          <div className="flex items-center gap-3 text-sm">
            <span className="text-ink-soft">{user.name || user.email} · {ROLE_LABELS[user.role]}</span>
            <Link href="/" className="underline">Ver tienda</Link>
            <form action={logoutAction}><button className="underline">Salir</button></form>
          </div>
        </div>
      </header>
      <div className="mx-auto grid max-w-[1400px] gap-4 px-4 py-4 lg:grid-cols-[210px_1fr] lg:gap-8">
        <AdminNav items={items} />
        <main id="contenido" className="min-w-0">{children}</main>
      </div>
    </div>
  );
}
