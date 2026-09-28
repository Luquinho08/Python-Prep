import "server-only";
import { notFound, redirect } from "next/navigation";
import { can, isStaff, type Permission } from "./permissions";
import { getCurrentUser, type SessionUser } from "./session";

export class AuthError extends Error {
  constructor(message = "No tenés permiso para realizar esta acción.") {
    super(message);
  }
}

/**
 * Para páginas del admin. Sin sesión → ingresar. Cliente → 404 (no se revela el panel).
 * Personal sin el permiso → vuelve al resumen con aviso.
 */
export async function requirePagePermission(permission: Permission): Promise<SessionUser> {
  const user = await requireStaffPage();
  if (!can(user.role, permission)) redirect("/admin?sin_permiso=1");
  return user;
}

export async function requireStaffPage(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/cuenta/ingresar?next=/admin");
  if (!isStaff(user.role)) notFound();
  return user;
}

/** Para server actions y route handlers: lanza AuthError. */
export async function requirePermission(permission: Permission): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user || !can(user.role, permission)) throw new AuthError();
  return user;
}

export async function requireUserPage(next = "/cuenta"): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) redirect(`/cuenta/ingresar?next=${encodeURIComponent(next)}`);
  return user;
}
