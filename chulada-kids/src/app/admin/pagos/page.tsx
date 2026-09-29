import { desc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { paymentConnections, webhookEvents } from "@/lib/db/schema";
import { requirePagePermission } from "@/lib/auth/guards";
import { getConnectionInfo } from "@/lib/payments/connection";
import { env } from "@/lib/env";
import { formatStoreDateTime } from "@/lib/time";
import { Card, FlashFromParams, PageHeader, Table } from "@/components/admin/ui";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { inputClasses } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { connectManualAction, disconnectAction, startOAuthAction, verifyConnectionAction } from "./actions";

export default async function PaymentsAdmin(props: PageProps<"/admin/pagos">) {
  await requirePagePermission("payments:manage");
  const info = await getConnectionInfo();
  const [history, [hooks]] = await Promise.all([
    db.select().from(paymentConnections).orderBy(desc(paymentConnections.createdAt)).limit(10),
    db.select({ total: sql<number>`count(*)::int`, rejected: sql<number>`count(*) FILTER (WHERE status = 'rejected')::int`, failed: sql<number>`count(*) FILTER (WHERE status = 'failed')::int`, last: sql<string>`max(created_at)` }).from(webhookEvents).where(eq(webhookEvents.provider, "mercadopago")),
  ]);
  const webhookUrl = `${env.appUrl}/api/webhooks/mercadopago`;
  const statusTone = info.status === "connected" ? "mint" : info.status === "not_configured" ? "neutral" : "coral";
  const statusLabel = { connected: "Conectado", disconnected: "Desconectado", revoked: "Autorización revocada", error: "Con error", not_configured: "Sin configurar" }[info.status];

  return (
    <div className="space-y-5">
      <PageHeader title="Medios de pago" description="Mercado Pago Argentina. Un solo comercio receptor (sin comisión de marketplace). Los secretos nunca se muestran." />
      <FlashFromParams sp={await props.searchParams} />
      {info.source === "fake" ? (
        <Alert tone="warning" title="Simulador local activo (PAYMENTS_DRIVER=fake)">No es Mercado Pago. Sirve para desarrollo y pruebas automáticas. En producción está bloqueado.</Alert>
      ) : null}

      <Card title="Estado">
        <dl className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
          <div><dt className="text-xs text-ink-soft">Estado</dt><dd><Badge tone={statusTone}>{statusLabel}</Badge></dd></div>
          <div><dt className="text-xs text-ink-soft">Modo</dt><dd>{info.mode === "env" ? "Credenciales del servidor (variables de entorno)" : info.mode === "manual" ? "Credenciales cargadas por el propietario (cifradas)" : info.mode === "oauth" ? "OAuth (autorización)" : info.mode === "fake" ? "Simulador" : "—"}</dd></div>
          <div><dt className="text-xs text-ink-soft">Ambiente</dt><dd>{info.environment === "production" ? <Badge tone="coral">Producción (cobros reales)</Badge> : info.environment === "test" ? <Badge tone="yellow">Prueba</Badge> : "—"}</dd></div>
          <div><dt className="text-xs text-ink-soft">Cuenta receptora</dt><dd>{info.accountLabel ?? "—"} {info.accountId ? <span className="font-mono text-xs">({info.accountId})</span> : null}</dd></div>
          <div><dt className="text-xs text-ink-soft">Public Key</dt><dd className="font-mono text-xs">{info.publicKey ? `${info.publicKey.slice(0, 12)}…` : "—"}</dd></div>
          <div><dt className="text-xs text-ink-soft">Secreto de webhooks</dt><dd>{info.webhookSecretConfigured ? "Configurado" : <span className="font-semibold text-danger">Falta MP_WEBHOOK_SECRET</span>}</dd></div>
          {info.tokenExpiresAt ? <div><dt className="text-xs text-ink-soft">Token vence</dt><dd>{formatStoreDateTime(info.tokenExpiresAt)}</dd></div> : null}
        </dl>
        {info.lastError ? <Alert tone="error" className="mt-3">{info.lastError}</Alert> : null}
        {info.source === "env" ? <form action={verifyConnectionAction} className="mt-3"><SubmitButton size="sm" variant="secondary" pendingLabel="Verificando…">Verificar conexión</SubmitButton></form> : null}
      </Card>

      <Card title="Diagnóstico de notificaciones">
        <p className="text-sm">URL para configurar en <em>Tus integraciones → Webhooks</em> (tópicos: Order y Pagos): <code className="break-all rounded bg-surface-soft px-1">{webhookUrl}</code></p>
        {!webhookUrl.startsWith("https://") ? <Alert tone="warning" className="mt-2">La URL no es HTTPS: Mercado Pago no podrá notificar a un entorno local. Se usa la conciliación programada.</Alert> : null}
        <p className="mt-2 text-sm">Recibidas: {hooks.total} · Firma inválida: {hooks.rejected} · Con error pendiente de reintento: {hooks.failed}{hooks.last ? ` · Última: ${formatStoreDateTime(hooks.last)}` : ""}</p>
      </Card>

      {info.source !== "env" && info.source !== "fake" ? (
        <>
          <Card title="Conectar con OAuth (recomendado si la app de MP es de un integrador)">
            {info.oauthAvailable ? (
              <form action={startOAuthAction} className="flex flex-wrap items-end gap-2">
                <div><label className="text-sm" htmlFor="oauth-env">Ambiente</label>
                  <select id="oauth-env" name="environment" className={inputClasses}><option value="test">Prueba</option><option value="production">Producción</option></select>
                </div>
                <SubmitButton>Conectar Mercado Pago</SubmitButton>
              </form>
            ) : (
              <p className="text-sm text-ink-soft">No disponible: faltan MP_CLIENT_ID, MP_CLIENT_SECRET y MP_OAUTH_REDIRECT_URI en el servidor. Si la aplicación de Mercado Pago es de la propia cuenta de Chulada Kids, usá credenciales (abajo) o variables de entorno.</p>
            )}
          </Card>
          <Card title="Conectar con credenciales de la aplicación (solo propietario)">
            <p className="mb-3 text-sm text-ink-soft">Copiá Access Token y Public Key desde Mercado Pago Developers → tu aplicación → Credenciales. Se validan con Mercado Pago, se guardan cifradas y no vuelven a mostrarse. No las compartas por chat ni email.</p>
            <form action={connectManualAction} className="grid gap-3 md:grid-cols-2" autoComplete="off">
              <div><label className="text-sm" htmlFor="mp-at">Access Token</label><input id="mp-at" name="accessToken" type="password" autoComplete="off" className={inputClasses} /></div>
              <div><label className="text-sm" htmlFor="mp-pk">Public Key</label><input id="mp-pk" name="publicKey" autoComplete="off" className={inputClasses} /></div>
              <div><label className="text-sm" htmlFor="mp-env">Ambiente</label><select id="mp-env" name="environment" className={inputClasses}><option value="test">Prueba</option><option value="production">Producción</option></select></div>
              <label className="flex items-end gap-2 pb-3 text-sm"><input type="checkbox" name="confirmProduction" /> Si es producción: confirmo que terminé las pruebas y autorizo cobros reales</label>
              <div><SubmitButton>Validar y conectar</SubmitButton></div>
            </form>
          </Card>
        </>
      ) : null}

      {info.source === "db" && info.status === "connected" ? (
        <Card title="Desconectar">
          <form action={disconnectAction} className="flex flex-wrap items-center gap-3 text-sm">
            <label className="flex items-center gap-2"><input type="checkbox" name="confirm" /> Entiendo que se bloquean los cobros nuevos. Para conciliar pagos anteriores habrá que reconectar la misma cuenta.</label>
            <SubmitButton variant="danger" size="sm">Desconectar</SubmitButton>
          </form>
        </Card>
      ) : null}

      {history.length ? (
        <Card title="Historial de conexiones">
          <Table>
            <thead><tr><th>Fecha</th><th>Modo</th><th>Ambiente</th><th>Cuenta</th><th>Estado</th></tr></thead>
            <tbody>{history.map((h) => <tr key={h.id}><td className="text-xs">{formatStoreDateTime(h.createdAt)}</td><td>{h.mode}</td><td>{h.environment}</td><td>{h.accountLabel ?? h.accountId}</td><td>{h.status}</td></tr>)}</tbody>
          </Table>
        </Card>
      ) : null}
    </div>
  );
}
