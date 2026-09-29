"use server";
import { and, eq, gt, isNull } from "drizzle-orm";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/lib/db";
import { authTokens, users } from "@/lib/db/schema";
import { hashPassword, passwordProblem, verifyPassword } from "@/lib/auth/password";
import { createSession, destroyAllSessionsForUser, destroySession } from "@/lib/auth/session";
import { attachCartToUser } from "@/lib/cart/service";
import { randomToken, sha256 } from "@/lib/crypto";
import { enqueueEmail } from "@/lib/email/outbox";
import { env } from "@/lib/env";
import { rateLimit } from "@/lib/rate-limit";
import { clientIp } from "@/lib/request";
import { isStaff } from "@/lib/auth/permissions";

export type AuthState = { ok: boolean; message: string; fieldErrors?: Record<string, string> } | null;

function safeNext(next: unknown, fallback: string) {
  const n = typeof next === "string" ? next : "";
  return n.startsWith("/") && !n.startsWith("//") && !n.startsWith("/\\") ? n : fallback;
}

const emailSchema = z.string().trim().toLowerCase().email("Ingresá un email válido.").max(160);

export async function loginAction(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const email = emailSchema.safeParse(formData.get("email"));
  const password = String(formData.get("password") ?? "");
  if (!email.success || !password) return { ok: false, message: "Ingresá tu email y contraseña." };
  const ip = await clientIp();
  if (!(await rateLimit(`login-ip:${ip}`, 30, 900)) || !(await rateLimit(`login-email:${email.data}`, 10, 900))) {
    return { ok: false, message: "Demasiados intentos. Esperá 15 minutos y volvé a probar." };
  }
  const [u] = await db.select().from(users).where(and(eq(users.email, email.data), isNull(users.disabledAt)));
  const valid = await verifyPassword(u?.passwordHash ?? null, password);
  if (!u || !valid) return { ok: false, message: "Email o contraseña incorrectos." };
  await createSession(u.id);
  await attachCartToUser(u.id);
  redirect(safeNext(formData.get("next"), isStaff(u.role) ? "/admin" : "/cuenta"));
}

export async function registerAction(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const schema = z.object({
    name: z.string().trim().min(2, "Ingresá tu nombre.").max(80),
    email: emailSchema,
    password: z.string(),
  });
  const parsed = schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    const fe: Record<string, string> = {};
    for (const i of parsed.error.issues) fe[String(i.path[0])] ??= i.message;
    return { ok: false, message: "Revisá los datos.", fieldErrors: fe };
  }
  const pwErr = passwordProblem(parsed.data.password);
  if (pwErr) return { ok: false, message: "Revisá los datos.", fieldErrors: { password: pwErr } };
  if (!(await rateLimit(`register:${await clientIp()}`, 10, 3600))) return { ok: false, message: "Demasiados registros desde esta conexión. Probá más tarde." };
  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, parsed.data.email));
  if (existing) return { ok: false, message: "No pudimos crear la cuenta con ese email. Si ya tenés cuenta, ingresá o recuperá tu contraseña." };
  const [u] = await db
    .insert(users)
    .values({ email: parsed.data.email, name: parsed.data.name, passwordHash: await hashPassword(parsed.data.password), role: "customer" })
    .returning();
  await createSession(u.id);
  await attachCartToUser(u.id);
  redirect(safeNext(formData.get("next"), "/cuenta"));
}

export async function logoutAction() {
  await destroySession();
  redirect("/");
}

/** Siempre responde lo mismo, exista o no la cuenta (evita enumeración). */
export async function requestPasswordResetAction(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const email = emailSchema.safeParse(formData.get("email"));
  const generic: AuthState = { ok: true, message: "Si el email está registrado, te enviamos un enlace para crear una nueva contraseña. Vence en 1 hora." };
  if (!email.success) return { ok: false, message: "Ingresá un email válido." };
  if (!(await rateLimit(`reset-ip:${await clientIp()}`, 10, 3600)) || !(await rateLimit(`reset-email:${email.data}`, 3, 3600))) return generic;
  const [u] = await db.select().from(users).where(and(eq(users.email, email.data), isNull(users.disabledAt)));
  if (u) {
    const token = randomToken(32);
    await db.insert(authTokens).values({ id: sha256(token), kind: "password_reset", userId: u.id, expiresAt: new Date(Date.now() + 3600_000) });
    await enqueueEmail({
      dedupeKey: `reset:${sha256(token)}`,
      to: u.email,
      subject: "Creá una nueva contraseña — Chulada Kids",
      text: `Hola ${u.name || ""}. Para crear una nueva contraseña entrá a:\n${env.appUrl}/cuenta/restablecer?token=${token}\n\nEl enlace vence en 1 hora. Si no lo pediste, ignorá este email.`,
    });
  }
  return generic;
}

async function consumeToken(token: string, kind: "password_reset" | "invitation") {
  const id = sha256(token);
  const [row] = await db
    .update(authTokens)
    .set({ usedAt: new Date() })
    .where(and(eq(authTokens.id, id), eq(authTokens.kind, kind), isNull(authTokens.usedAt), gt(authTokens.expiresAt, new Date())))
    .returning();
  return row ?? null;
}

export async function resetPasswordAction(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const token = String(formData.get("token") ?? "");
  const password = String(formData.get("password") ?? "");
  const pwErr = passwordProblem(password);
  if (pwErr) return { ok: false, message: pwErr, fieldErrors: { password: pwErr } };
  const row = await consumeToken(token, "password_reset");
  if (!row?.userId) return { ok: false, message: "El enlace venció o ya se usó. Pedí uno nuevo." };
  await db.update(users).set({ passwordHash: await hashPassword(password), updatedAt: new Date() }).where(eq(users.id, row.userId));
  await destroyAllSessionsForUser(row.userId);
  await createSession(row.userId);
  redirect("/cuenta?contrasena=actualizada");
}

/** Aceptar invitación de equipo: crea o actualiza la cuenta con el rol invitado. */
export async function acceptInvitationAction(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const token = String(formData.get("token") ?? "");
  const name = String(formData.get("name") ?? "").trim().slice(0, 80);
  const password = String(formData.get("password") ?? "");
  const pwErr = passwordProblem(password);
  if (pwErr) return { ok: false, message: pwErr, fieldErrors: { password: pwErr } };
  if (name.length < 2) return { ok: false, message: "Ingresá tu nombre.", fieldErrors: { name: "Ingresá tu nombre." } };
  const row = await consumeToken(token, "invitation");
  if (!row?.email || !row.role) return { ok: false, message: "La invitación venció o ya se usó. Pedile una nueva al propietario." };
  const hash = await hashPassword(password);
  const [u] = await db
    .insert(users)
    .values({ email: row.email, name, role: row.role, passwordHash: hash, emailVerifiedAt: new Date() })
    .onConflictDoUpdate({ target: users.email, set: { role: row.role, passwordHash: hash, name, disabledAt: null, updatedAt: new Date() } })
    .returning();
  await destroyAllSessionsForUser(u.id);
  await createSession(u.id);
  redirect("/admin");
}
