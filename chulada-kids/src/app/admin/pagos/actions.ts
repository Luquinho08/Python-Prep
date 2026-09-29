"use server";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requirePermission } from "@/lib/auth/guards";
import { audit } from "@/lib/audit";
import { redirectError, redirectOk } from "@/lib/admin/flash";
import { connectManual, disconnect, fetchAccount, getConnectionInfo, startOAuth } from "@/lib/payments/connection";
import { getCurrentUser } from "@/lib/auth/session";
import { rateLimit } from "@/lib/rate-limit";

export async function connectManualAction(formData: FormData) {
  const user = await requirePermission("payments:manage");
  if (!(await rateLimit(`mp-connect:${user.id}`, 10, 3600))) redirectError("/admin/pagos", "Demasiados intentos. Probá más tarde.");
  const parsed = z
    .object({
      accessToken: z.string().trim().min(20).max(300).regex(/^(APP_USR|TEST)-[A-Za-z0-9-]+$/, "El Access Token no tiene el formato esperado."),
      publicKey: z.string().trim().min(20).max(200).regex(/^(APP_USR|TEST)-[A-Za-z0-9-]+$/, "La Public Key no tiene el formato esperado."),
      environment: z.enum(["test", "production"]),
    })
    .safeParse({ accessToken: formData.get("accessToken"), publicKey: formData.get("publicKey"), environment: formData.get("environment") });
  if (!parsed.success) redirectError("/admin/pagos", parsed.error.issues[0].message);
  if (parsed.data.environment === "production" && formData.get("confirmProduction") !== "on") {
    redirectError("/admin/pagos", "Para producción confirmá que las pruebas terminaron y autorizás cobros reales.");
  }
  let label = "";
  try {
    const acct = await connectManual({ ...parsed.data, userId: user.id });
    label = acct.label;
  } catch (e) {
    // El secreto nunca se registra ni se devuelve al navegador.
    redirectError("/admin/pagos", `No se pudo validar con Mercado Pago: ${(e as Error).message.slice(0, 160)}`);
  }
  await audit(user.id, "payments.connect_manual", "payment_connection", null, { environment: parsed.data.environment, account: label });
  redirectOk("/admin/pagos", `Conectado a la cuenta ${label} (${parsed.data.environment === "test" ? "prueba" : "producción"}).`);
}

export async function startOAuthAction(formData: FormData) {
  const user = await requirePermission("payments:manage");
  const session = await getCurrentUser();
  const environment = formData.get("environment") === "production" ? "production" : "test";
  let url: string;
  try {
    url = await startOAuth({ userId: user.id, sessionId: session!.sessionId, environment });
  } catch (e) {
    redirectError("/admin/pagos", (e as Error).message);
  }
  await audit(user.id, "payments.oauth_start", "payment_connection", null, { environment });
  redirect(url);
}

export async function disconnectAction(formData: FormData) {
  const user = await requirePermission("payments:manage");
  if (formData.get("confirm") !== "on") redirectError("/admin/pagos", "Confirmá la desconexión.");
  await disconnect(user.id);
  await audit(user.id, "payments.disconnect", "payment_connection", null);
  redirectOk("/admin/pagos", "Mercado Pago desconectado: los cobros nuevos quedan bloqueados. El historial se conserva.");
}

export async function verifyConnectionAction() {
  const user = await requirePermission("payments:manage");
  const info = await getConnectionInfo();
  if (info.source === "fake") redirectOk("/admin/pagos", "Simulador local activo: no hay cuenta real que verificar.");
  if (info.source === "env" && process.env.MP_ACCESS_TOKEN) {
    try {
      const a = await fetchAccount(process.env.MP_ACCESS_TOKEN);
      await audit(user.id, "payments.verify", "payment_connection", null, { account: a.label });
      redirectOk("/admin/pagos", `Credenciales válidas. Cuenta ${a.label} (${a.siteId ?? "país desconocido"}).`);
    } catch (e) {
      if ((e as { digest?: string }).digest?.startsWith("NEXT_REDIRECT")) throw e;
      redirectError("/admin/pagos", `No se pudo verificar: ${(e as Error).message.slice(0, 160)}`);
    }
  }
  redirectError("/admin/pagos", "Solo se puede verificar la conexión configurada por variables de entorno desde acá.");
}
