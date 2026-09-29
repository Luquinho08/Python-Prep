import "server-only";
import { createHash } from "node:crypto";
import { and, desc, eq, gt, isNull } from "drizzle-orm";
import { MercadoPagoConfig, OAuth, User } from "mercadopago";
import { db } from "../db";
import { oauthStates, paymentConnections, settings } from "../db/schema";
import { decryptSecret, encryptSecret, randomToken, sha256 } from "../crypto";
import { env } from "../env";
import { FakeGateway } from "./fake";
import { MercadoPagoGateway } from "./mercadopago";
import { GatewayConfigError, type PaymentGateway } from "./types";

/* eslint-disable @typescript-eslint/no-explicit-any */

export type ConnectionInfo = {
  source: "env" | "db" | "fake" | null;
  mode: "env" | "manual" | "oauth" | "fake" | null;
  environment: "test" | "production" | null;
  accountId: string | null;
  accountLabel: string | null;
  publicKey: string | null;
  status: "connected" | "disconnected" | "revoked" | "error" | "not_configured";
  lastError: string | null;
  connectedAt: Date | null;
  tokenExpiresAt: Date | null;
  webhookSecretConfigured: boolean;
  oauthAvailable: boolean;
};

const ENV_ACCOUNT_KEY = "mp_env_account";

async function envAccount(): Promise<{ id: string; label: string } | null> {
  if (process.env.MP_COLLECTOR_ID) return { id: process.env.MP_COLLECTOR_ID, label: process.env.MP_COLLECTOR_ID };
  const fingerprint = createHash("sha256").update(process.env.MP_ACCESS_TOKEN ?? "").digest("hex").slice(0, 16);
  const [row] = await db.select().from(settings).where(eq(settings.key, ENV_ACCOUNT_KEY));
  const v = row?.value as { fingerprint: string; id: string; label: string } | undefined;
  if (v && v.fingerprint === fingerprint) return { id: v.id, label: v.label };
  return null;
}

/** Consulta /users/me para conocer la cuenta receptora y su país (debe ser MLA). */
export async function fetchAccount(accessToken: string): Promise<{ id: string; label: string; siteId: string | null }> {
  const me: any = await new User(new MercadoPagoConfig({ accessToken, options: { timeout: 15000 } })).get();
  return { id: String(me.id), label: me.nickname ?? me.email ?? String(me.id), siteId: me.site_id ?? null };
}

export async function getActiveDbConnection() {
  const [row] = await db
    .select()
    .from(paymentConnections)
    .where(eq(paymentConnections.provider, "mercadopago"))
    .orderBy(desc(paymentConnections.createdAt))
    .limit(1);
  return row ?? null;
}

export async function getConnectionInfo(): Promise<ConnectionInfo> {
  const base = {
    webhookSecretConfigured: !!env.mpWebhookSecret,
    oauthAvailable: !!(process.env.MP_CLIENT_ID && process.env.MP_CLIENT_SECRET && process.env.MP_OAUTH_REDIRECT_URI),
  };
  if (env.paymentsDriver === "fake") {
    return { ...base, source: "fake", mode: "fake", environment: "test", accountId: "fake-collector-0001", accountLabel: "Simulador local (no es Mercado Pago)", publicKey: "FAKE-PUBLIC-KEY", status: "connected", lastError: null, connectedAt: null, tokenExpiresAt: null };
  }
  if (process.env.MP_ACCESS_TOKEN) {
    const acct = await envAccount();
    return {
      ...base,
      source: "env",
      mode: "env",
      environment: process.env.MP_ENVIRONMENT === "production" ? "production" : "test",
      accountId: acct?.id ?? null,
      accountLabel: acct?.label ?? "Sin verificar (usá “Verificar conexión”)",
      publicKey: process.env.MP_PUBLIC_KEY ?? null,
      status: process.env.MP_PUBLIC_KEY ? "connected" : "error",
      lastError: process.env.MP_PUBLIC_KEY ? null : "Falta MP_PUBLIC_KEY para inicializar los componentes de pago.",
      connectedAt: null,
      tokenExpiresAt: null,
    };
  }
  const row = await getActiveDbConnection();
  if (!row) return { ...base, source: null, mode: null, environment: null, accountId: null, accountLabel: null, publicKey: null, status: "not_configured", lastError: null, connectedAt: null, tokenExpiresAt: null };
  return {
    ...base,
    source: "db",
    mode: row.mode,
    environment: row.environment,
    accountId: row.accountId,
    accountLabel: row.accountLabel,
    publicKey: row.publicKey,
    status: row.status,
    lastError: row.lastError,
    connectedAt: row.connectedAt,
    tokenExpiresAt: row.tokenExpiresAt,
  };
}

/** Gateway activo o null si no hay conexión utilizable (en ese caso se bloquean los cobros). */
export async function getGateway(): Promise<PaymentGateway | null> {
  if (env.paymentsDriver === "fake") return new FakeGateway();
  if (process.env.MP_ACCESS_TOKEN) {
    let acct = await envAccount();
    if (!acct) {
      try {
        const a = await fetchAccount(process.env.MP_ACCESS_TOKEN);
        const fingerprint = createHash("sha256").update(process.env.MP_ACCESS_TOKEN).digest("hex").slice(0, 16);
        await db
          .insert(settings)
          .values({ key: ENV_ACCOUNT_KEY, value: { fingerprint, id: a.id, label: a.label, siteId: a.siteId } })
          .onConflictDoUpdate({ target: settings.key, set: { value: { fingerprint, id: a.id, label: a.label, siteId: a.siteId }, updatedAt: new Date() } });
        acct = a;
      } catch {
        acct = null; // Sin cuenta verificada: se valida igual la moneda/importe/referencia; se registra la limitación.
      }
    }
    return new MercadoPagoGateway(process.env.MP_ACCESS_TOKEN, process.env.MP_ENVIRONMENT === "production" ? "production" : "test", process.env.MP_PUBLIC_KEY ?? null, acct?.id ?? null);
  }
  const row = await getActiveDbConnection();
  if (!row || row.status !== "connected" || !row.accessTokenEnc) return null;
  let accessToken = decryptSecret(row.accessTokenEnc);
  if (row.mode === "oauth" && row.tokenExpiresAt && row.tokenExpiresAt.getTime() - Date.now() < 7 * 86400_000) {
    accessToken = (await refreshOAuthConnection(row.id)) ?? accessToken;
  }
  return new MercadoPagoGateway(accessToken, row.environment, row.publicKey, row.accountId);
}

export async function requireGateway(): Promise<PaymentGateway> {
  const g = await getGateway();
  if (!g) throw new GatewayConfigError("Mercado Pago no está conectado: los cobros están deshabilitados.");
  return g;
}

export async function markConnectionRevoked(message: string) {
  const row = await getActiveDbConnection();
  if (row && row.status === "connected") {
    await db.update(paymentConnections).set({ status: "revoked", lastError: message, updatedAt: new Date() }).where(eq(paymentConnections.id, row.id));
  }
}

// ───────────── Modo credenciales cargadas por el propietario ─────────────

export async function connectManual(input: { accessToken: string; publicKey: string; environment: "test" | "production"; userId: string }) {
  const acct = await fetchAccount(input.accessToken); // lanza si el token es inválido o no hay red
  if (acct.siteId && acct.siteId !== "MLA") throw new GatewayConfigError(`La cuenta pertenece a ${acct.siteId}; Chulada Kids cobra en Argentina (MLA).`);
  await db.update(paymentConnections).set({ status: "disconnected", disconnectedAt: new Date() }).where(eq(paymentConnections.status, "connected"));
  await db.insert(paymentConnections).values({
    mode: "manual",
    environment: input.environment,
    accountId: acct.id,
    accountLabel: acct.label,
    siteId: acct.siteId,
    publicKey: input.publicKey,
    accessTokenEnc: encryptSecret(input.accessToken),
    status: "connected",
    connectedBy: input.userId,
    connectedAt: new Date(),
  });
  return acct;
}

export async function disconnect(userId: string) {
  const row = await getActiveDbConnection();
  if (!row) return;
  // Se conservan cuenta y ambiente para trazabilidad; se borran los secretos para impedir nuevos cobros.
  await db
    .update(paymentConnections)
    .set({ status: "disconnected", accessTokenEnc: null, refreshTokenEnc: null, disconnectedAt: new Date(), lastError: `Desconectado por ${userId}`, updatedAt: new Date() })
    .where(eq(paymentConnections.id, row.id));
}

// ───────────── Modo OAuth (Authorization Code) ─────────────

function pkceEnabled() {
  return process.env.MP_OAUTH_PKCE === "true";
}

export async function startOAuth(opts: { userId: string; sessionId: string; environment: "test" | "production" }) {
  const clientId = process.env.MP_CLIENT_ID;
  const redirectUri = process.env.MP_OAUTH_REDIRECT_URI;
  if (!clientId || !process.env.MP_CLIENT_SECRET || !redirectUri) throw new GatewayConfigError("OAuth no configurado (faltan MP_CLIENT_ID, MP_CLIENT_SECRET o MP_OAUTH_REDIRECT_URI).");
  const state = randomToken(32);
  const verifier = pkceEnabled() ? randomToken(48) : null;
  await db.insert(oauthStates).values({
    id: sha256(state),
    sessionId: opts.sessionId,
    userId: opts.userId,
    environment: opts.environment,
    codeVerifierEnc: verifier ? encryptSecret(verifier) : null,
    expiresAt: new Date(Date.now() + 10 * 60_000),
  });
  const options: any = { client_id: clientId, redirect_uri: redirectUri, state };
  if (verifier) {
    options.code_challenge = createHash("sha256").update(verifier).digest("base64url");
    options.code_challenge_method = "S256";
  }
  return new OAuth(new MercadoPagoConfig({ accessToken: "" })).getAuthorizationURL({ options });
}

/** Valida state (un solo uso, ligado a la sesión, 10 min) e intercambia el code en el backend. */
export async function completeOAuth(opts: { state: string; code: string; sessionId: string; userId: string }) {
  const [st] = await db
    .update(oauthStates)
    .set({ usedAt: new Date() })
    .where(and(eq(oauthStates.id, sha256(opts.state)), isNull(oauthStates.usedAt), gt(oauthStates.expiresAt, new Date()), eq(oauthStates.sessionId, opts.sessionId), eq(oauthStates.userId, opts.userId)))
    .returning();
  if (!st) throw new GatewayConfigError("La autorización venció o no corresponde a esta sesión. Volvé a iniciar la conexión.");
  const body: any = {
    client_id: process.env.MP_CLIENT_ID,
    client_secret: process.env.MP_CLIENT_SECRET,
    code: opts.code,
    redirect_uri: process.env.MP_OAUTH_REDIRECT_URI,
  };
  if (st.codeVerifierEnc) body.code_verifier = decryptSecret(st.codeVerifierEnc);
  const tok: any = await new OAuth(new MercadoPagoConfig({ accessToken: "" })).create({ body });
  if (!tok.access_token) throw new GatewayConfigError("Mercado Pago no devolvió un token.");
  const acct = await fetchAccount(tok.access_token).catch(() => null);
  const environment = tok.live_mode === true ? "production" : tok.live_mode === false ? "test" : st.environment;
  if (environment !== st.environment) throw new GatewayConfigError(`El ambiente autorizado (${environment}) no coincide con el solicitado (${st.environment}).`);
  await db.update(paymentConnections).set({ status: "disconnected", disconnectedAt: new Date() }).where(eq(paymentConnections.status, "connected"));
  await db.insert(paymentConnections).values({
    mode: "oauth",
    environment,
    accountId: tok.user_id != null ? String(tok.user_id) : acct?.id ?? null,
    accountLabel: acct?.label ?? null,
    siteId: acct?.siteId ?? null,
    publicKey: tok.public_key ?? null,
    accessTokenEnc: encryptSecret(tok.access_token),
    refreshTokenEnc: tok.refresh_token ? encryptSecret(tok.refresh_token) : null,
    tokenExpiresAt: tok.expires_in ? new Date(Date.now() + Number(tok.expires_in) * 1000) : null,
    status: "connected",
    connectedBy: opts.userId,
    connectedAt: new Date(),
  });
}

export async function refreshOAuthConnection(connectionId: string): Promise<string | null> {
  const [row] = await db.select().from(paymentConnections).where(eq(paymentConnections.id, connectionId));
  if (!row?.refreshTokenEnc) return null;
  try {
    const tok: any = await new OAuth(new MercadoPagoConfig({ accessToken: "" })).refresh({
      body: { client_id: process.env.MP_CLIENT_ID, client_secret: process.env.MP_CLIENT_SECRET, refresh_token: decryptSecret(row.refreshTokenEnc) },
    });
    if (!tok.access_token) throw new Error("Sin token");
    await db
      .update(paymentConnections)
      .set({
        accessTokenEnc: encryptSecret(tok.access_token),
        refreshTokenEnc: tok.refresh_token ? encryptSecret(tok.refresh_token) : row.refreshTokenEnc,
        tokenExpiresAt: tok.expires_in ? new Date(Date.now() + Number(tok.expires_in) * 1000) : row.tokenExpiresAt,
        lastError: null,
        updatedAt: new Date(),
      })
      .where(eq(paymentConnections.id, row.id));
    return tok.access_token;
  } catch (e) {
    const status = (e as { status?: number }).status;
    await db
      .update(paymentConnections)
      .set({ status: status === 400 || status === 401 ? "revoked" : row.status, lastError: `Renovación fallida: ${(e as Error).message}`.slice(0, 300), updatedAt: new Date() })
      .where(eq(paymentConnections.id, row.id));
    return null;
  }
}
