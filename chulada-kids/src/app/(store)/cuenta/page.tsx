import type { Metadata } from "next";
import Link from "next/link";
import { desc, eq, isNull, and } from "drizzle-orm";
import { db } from "@/lib/db";
import { addresses, orders, users } from "@/lib/db/schema";
import { requireUserPage } from "@/lib/auth/guards";
import { isStaff } from "@/lib/auth/permissions";
import { orderNumber } from "@/lib/orders/access";
import { formatARS } from "@/lib/money";
import { formatStoreDateTime } from "@/lib/time";
import { FULFILLMENT_LABEL, type FulfillmentStatus } from "@/lib/orders/status";
import { PAYMENT_STATUS_LABEL } from "@/lib/payments/status";
import { logoutAction } from "@/app/actions/auth";
import { deleteAddressAction, saveAddressAction, saveProfileAction } from "@/app/actions/account";
import { FlashFromParams } from "@/components/admin/ui";
import { EmptyState } from "@/components/ui/empty-state";
import { ButtonLink } from "@/components/ui/button";
import { inputClasses } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { Badge } from "@/components/ui/badge";

export const metadata: Metadata = { title: "Mi cuenta", robots: { index: false } };

export default async function AccountPage(props: PageProps<"/cuenta">) {
  const session = await requireUserPage("/cuenta");
  const sp = await props.searchParams;
  const [[u], myOrders, myAddresses] = await Promise.all([
    db.select().from(users).where(eq(users.id, session.id)),
    db.select().from(orders).where(and(eq(orders.userId, session.id), isNull(orders.supersededBy))).orderBy(desc(orders.createdAt)).limit(50),
    db.select().from(addresses).where(eq(addresses.userId, session.id)),
  ]);
  return (
    <div className="mx-auto max-w-4xl space-y-8 px-4 py-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Hola, {u.name || u.email}</h1>
        <div className="flex gap-2">
          {isStaff(u.role) ? <ButtonLink href="/admin" variant="secondary" size="sm">Ir al panel</ButtonLink> : null}
          <form action={logoutAction}><SubmitButton variant="ghost" size="sm" pendingLabel="Saliendo…">Cerrar sesión</SubmitButton></form>
        </div>
      </div>
      {sp.contrasena ? <p className="rounded-xl bg-brand-mint/50 px-4 py-2 text-sm" role="status">Tu contraseña se actualizó.</p> : null}
      <FlashFromParams sp={sp} />

      <section aria-labelledby="h-orders">
        <h2 id="h-orders" className="text-xl font-bold">Mis pedidos</h2>
        <p className="text-sm text-ink-soft">Se muestran los pedidos hechos con la sesión iniciada. Para compras como invitado, usá el enlace del email o <Link className="underline" href="/pedido">consultá tu pedido</Link>.</p>
        {myOrders.length === 0 ? (
          <div className="mt-4"><EmptyState title="Todavía no tenés pedidos" action={<ButtonLink href="/productos">Ver productos</ButtonLink>} /></div>
        ) : (
          <ul className="mt-4 space-y-3">
            {myOrders.map((o) => (
              <li key={o.id} className="flex flex-wrap items-center justify-between gap-2 rounded-card border border-line bg-white p-4">
                <div>
                  <Link href={`/cuenta/pedidos/${o.id}`} className="font-semibold underline">{orderNumber(o.number)}</Link>
                  <p className="text-xs text-ink-soft">{formatStoreDateTime(o.createdAt)} · {formatARS(o.totalCents)}</p>
                </div>
                <div className="flex flex-wrap gap-1">
                  <Badge tone={o.paymentStatus === "approved" ? "mint" : "yellow"}>{PAYMENT_STATUS_LABEL[o.paymentStatus]}</Badge>
                  <Badge tone="lavender">{FULFILLMENT_LABEL[o.fulfillmentStatus as FulfillmentStatus]}</Badge>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="h-profile" className="rounded-card border border-line bg-white p-4">
        <h2 id="h-profile" className="text-lg font-bold">Mis datos</h2>
        <form action={saveProfileAction} className="mt-3 grid gap-3 sm:grid-cols-3">
          <div><label className="text-sm" htmlFor="pf-name">Nombre</label><input id="pf-name" name="name" defaultValue={u.name} className={inputClasses} /></div>
          <div><label className="text-sm" htmlFor="pf-phone">Teléfono</label><input id="pf-phone" name="phone" defaultValue={u.phone ?? ""} className={inputClasses} /></div>
          <div className="flex items-end"><SubmitButton>Guardar</SubmitButton></div>
        </form>
        <p className="mt-2 text-xs text-ink-soft">Email: {u.email}. Para cambiar la contraseña usá <Link className="underline" href="/cuenta/recuperar">recuperar contraseña</Link>.</p>
      </section>

      <section aria-labelledby="h-addr" className="rounded-card border border-line bg-white p-4">
        <h2 id="h-addr" className="text-lg font-bold">Direcciones</h2>
        <ul className="mt-2 space-y-2 text-sm">
          {myAddresses.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-surface-soft px-3 py-2">
              <span><strong>{a.label}</strong>: {a.recipient} — {a.street} {a.number}{a.apartment ? `, ${a.apartment}` : ""}, {a.city}, {a.province} ({a.postalCode})</span>
              <form action={deleteAddressAction}><input type="hidden" name="id" value={a.id} /><button className="text-xs text-danger underline">Eliminar</button></form>
            </li>
          ))}
        </ul>
        <details className="mt-3">
          <summary className="cursor-pointer text-sm font-semibold">Agregar dirección</summary>
          <form action={saveAddressAction} className="mt-3 grid gap-3 sm:grid-cols-3">
            {[
              ["label", "Nombre (Casa, Trabajo)"],
              ["recipient", "Quién recibe"],
              ["street", "Calle"],
              ["number", "Altura"],
              ["apartment", "Piso/depto."],
              ["city", "Localidad"],
              ["province", "Provincia"],
              ["postalCode", "Código postal"],
              ["notes", "Indicaciones"],
            ].map(([n, l]) => (
              <div key={n}><label className="text-sm" htmlFor={`ad-${n}`}>{l}</label><input id={`ad-${n}`} name={n} className={inputClasses} /></div>
            ))}
            <div className="sm:col-span-3"><SubmitButton>Guardar dirección</SubmitButton></div>
          </form>
        </details>
      </section>
    </div>
  );
}
