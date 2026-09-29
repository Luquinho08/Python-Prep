import { getCurrentUser } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { audit } from "@/lib/audit";
import { completeOAuth } from "@/lib/payments/connection";

/** Callback de OAuth: valida state (un solo uso, ligado a la sesión) e intercambia el code en el backend. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const to = (q: string) => Response.redirect(new URL(`/admin/pagos?${q}`, req.url), 303);
  const user = await getCurrentUser();
  if (!user || !can(user.role, "payments:manage")) return new Response("No autorizado", { status: 403 });
  if (url.searchParams.get("error")) return to(`error=${encodeURIComponent("La autorización fue cancelada o rechazada en Mercado Pago.")}`);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state) return to(`error=${encodeURIComponent("Respuesta de autorización incompleta.")}`);
  try {
    await completeOAuth({ code, state, sessionId: user.sessionId, userId: user.id });
  } catch (e) {
    return to(`error=${encodeURIComponent((e as Error).message.slice(0, 200))}`);
  }
  await audit(user.id, "payments.oauth_connected", "payment_connection", null);
  return to(`ok=${encodeURIComponent("Mercado Pago conectado mediante autorización.")}`);
}
