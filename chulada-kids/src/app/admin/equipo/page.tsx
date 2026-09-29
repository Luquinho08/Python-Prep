import { and, desc, eq, gt, inArray, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { authTokens, users } from "@/lib/db/schema";
import { requirePagePermission } from "@/lib/auth/guards";
import { ROLE_LABELS } from "@/lib/auth/permissions";
import { formatStoreDateTime } from "@/lib/time";
import { Card, FlashFromParams, PageHeader, Table } from "@/components/admin/ui";
import { inputClasses } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { inviteAction, updateMemberAction } from "./actions";

export default async function TeamAdmin(props: PageProps<"/admin/equipo">) {
  const me = await requirePagePermission("team:manage");
  const [staff, invites] = await Promise.all([
    db.select().from(users).where(inArray(users.role, ["owner", "catalog_editor", "order_operator"])).orderBy(desc(users.createdAt)),
    db.select().from(authTokens).where(and(eq(authTokens.kind, "invitation"), isNull(authTokens.usedAt), gt(authTokens.expiresAt, new Date()))),
  ]);
  return (
    <div className="space-y-6">
      <PageHeader title="Equipo" description="Propietario: todo, incluidos pagos y equipo. Editor de catálogo: productos, promociones y contenido. Operador de pedidos: pedidos y clientes." />
      <FlashFromParams sp={await props.searchParams} />
      <Card title="Invitar">
        <form action={inviteAction} className="flex flex-wrap items-end gap-2">
          <div><label className="text-sm" htmlFor="inv-email">Email</label><input id="inv-email" name="email" type="email" required className={inputClasses} /></div>
          <div><label className="text-sm" htmlFor="inv-role">Rol</label>
            <select id="inv-role" name="role" className={inputClasses}>
              <option value="catalog_editor">Editor de catálogo</option>
              <option value="order_operator">Operador de pedidos</option>
              <option value="owner">Propietario</option>
            </select>
          </div>
          <SubmitButton>Crear invitación</SubmitButton>
        </form>
        {invites.length ? <p className="mt-3 text-xs text-ink-soft">Invitaciones pendientes: {invites.map((i) => `${i.email} (${i.role ? ROLE_LABELS[i.role] : ""}, vence ${formatStoreDateTime(i.expiresAt)})`).join(" · ")}</p> : null}
      </Card>
      <Table>
        <thead><tr><th>Persona</th><th>Rol</th><th>Estado</th><th>Acciones</th></tr></thead>
        <tbody>
          {staff.map((u) => (
            <tr key={u.id}>
              <td>{u.name || "—"}<div className="text-xs text-ink-soft">{u.email}</div></td>
              <td>
                <form action={updateMemberAction} className="flex items-center gap-2">
                  <input type="hidden" name="id" value={u.id} /><input type="hidden" name="op" value="role" />
                  <label className="sr-only" htmlFor={`r-${u.id}`}>Rol de {u.email}</label>
                  <select id={`r-${u.id}`} name="role" defaultValue={u.role} className="rounded-lg border-2 border-line px-2 py-1 text-sm">
                    {(["owner", "catalog_editor", "order_operator", "customer"] as const).map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}{r === "customer" ? " (quitar acceso)" : ""}</option>)}
                  </select>
                  <SubmitButton size="sm" variant="secondary">Cambiar</SubmitButton>
                </form>
              </td>
              <td>{u.disabledAt ? "Desactivado" : "Activo"}{u.id === me.id ? " (vos)" : ""}</td>
              <td>
                <form action={updateMemberAction}>
                  <input type="hidden" name="id" value={u.id} /><input type="hidden" name="op" value={u.disabledAt ? "enable" : "disable"} />
                  <SubmitButton size="sm" variant={u.disabledAt ? "secondary" : "danger"}>{u.disabledAt ? "Reactivar" : "Desactivar"}</SubmitButton>
                </form>
              </td>
            </tr>
          ))}
        </tbody>
      </Table>
    </div>
  );
}
