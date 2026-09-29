"use server";
import { and, eq, isNull, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { requirePermission } from "@/lib/auth/guards";
import { audit } from "@/lib/audit";
import { redirectError, redirectOk } from "@/lib/admin/flash";
import { createInvitation } from "@/lib/auth/invitations";
import { destroyAllSessionsForUser } from "@/lib/auth/session";
import { rateLimit } from "@/lib/rate-limit";

const staffRole = z.enum(["owner", "catalog_editor", "order_operator"]);

export async function inviteAction(formData: FormData) {
  const user = await requirePermission("team:manage");
  const email = z.string().trim().toLowerCase().email().safeParse(formData.get("email"));
  const role = staffRole.safeParse(formData.get("role"));
  if (!email.success || !role.success) redirectError("/admin/equipo", "Email o rol inválido.");
  if (!(await rateLimit(`invite:${user.id}`, 20, 3600))) redirectError("/admin/equipo", "Demasiadas invitaciones seguidas.");
  const link = await createInvitation(email.data, role.data, user.id);
  await audit(user.id, "team.invite", "user", null, { email: email.data, role: role.data });
  redirectOk("/admin/equipo", `Invitación creada para ${email.data}. Si el email no está configurado, compartí este enlace de un solo uso (vence en 7 días): ${link}`);
}

async function ownersLeft(excludeId: string) {
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(users).where(and(eq(users.role, "owner"), isNull(users.disabledAt), ne(users.id, excludeId)));
  return Number(n);
}

export async function updateMemberAction(formData: FormData) {
  const user = await requirePermission("team:manage");
  const id = z.string().uuid().parse(formData.get("id"));
  const op = String(formData.get("op"));
  const [target] = await db.select().from(users).where(eq(users.id, id));
  if (!target) redirectError("/admin/equipo", "Usuario inexistente.");
  if (op === "role") {
    const role = z.enum(["owner", "catalog_editor", "order_operator", "customer"]).parse(formData.get("role"));
    if (target.role === "owner" && role !== "owner" && (await ownersLeft(id)) === 0) redirectError("/admin/equipo", "Debe quedar al menos un propietario activo.");
    await db.update(users).set({ role, updatedAt: new Date() }).where(eq(users.id, id));
    await destroyAllSessionsForUser(id);
    await audit(user.id, "team.role", "user", id, { from: target.role, to: role });
    redirectOk("/admin/equipo", "Rol actualizado. La persona debe volver a ingresar.");
  }
  if (op === "disable") {
    if (target.role === "owner" && (await ownersLeft(id)) === 0) redirectError("/admin/equipo", "No podés desactivar al último propietario.");
    await db.update(users).set({ disabledAt: new Date() }).where(eq(users.id, id));
    await destroyAllSessionsForUser(id);
    await audit(user.id, "team.disable", "user", id);
    redirectOk("/admin/equipo", "Acceso desactivado.");
  }
  if (op === "enable") {
    await db.update(users).set({ disabledAt: null }).where(eq(users.id, id));
    await audit(user.id, "team.enable", "user", id);
    redirectOk("/admin/equipo", "Acceso reactivado.");
  }
  redirectError("/admin/equipo", "Operación desconocida.");
}
