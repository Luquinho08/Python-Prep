import "server-only";
import { and, asc, eq, lte, or } from "drizzle-orm";
import { WebhookSignatureValidator } from "mercadopago";
import { db } from "../db";
import { paymentAttempts, webhookEvents } from "../db/schema";
import { env } from "../env";
import { requireGateway } from "./connection";
import { applyProviderState, reconcileAttempt } from "./service";
import { aggregatePayments } from "./status";

export type IncomingWebhook = {
  dataId: string | null;
  type: string | null;
  xSignature: string | null;
  xRequestId: string | null;
  payload: unknown;
};

/** Valida x-signature con el validador oficial del SDK. Prueba data.id tal cual y en minúsculas (IDs alfanuméricos). */
export function verifyWebhookSignature(w: IncomingWebhook): { ok: boolean; reason?: string } {
  const secret = env.mpWebhookSecret;
  if (!secret) return { ok: false, reason: "MP_WEBHOOK_SECRET no configurado" };
  const tryWith = (dataId: string | null) => {
    WebhookSignatureValidator.validate({ xSignature: w.xSignature, xRequestId: w.xRequestId, dataId, secret, toleranceSeconds: 600 });
  };
  try {
    tryWith(w.dataId);
    return { ok: true };
  } catch (e) {
    if (w.dataId && w.dataId !== w.dataId.toLowerCase()) {
      try {
        tryWith(w.dataId.toLowerCase());
        return { ok: true };
      } catch {
        /* sigue abajo */
      }
    }
    return { ok: false, reason: (e as { reason?: string }).reason ?? "firma inválida" };
  }
}

/** Guarda la notificación de forma duradera ANTES de responder. Devuelve el id (o el existente si es duplicado). */
export async function recordWebhook(w: IncomingWebhook, signatureValid: boolean) {
  const topic = (w.type ?? "unknown").slice(0, 40);
  const resourceId = (w.dataId ?? "").slice(0, 120);
  const dedupeKey = `${topic}:${resourceId}:${w.xRequestId ?? "sin-request-id"}`;
  const [row] = await db
    .insert(webhookEvents)
    .values({
      provider: "mercadopago",
      topic,
      resourceId,
      requestId: w.xRequestId,
      dedupeKey,
      signatureValid,
      payload: (w.payload ?? {}) as object,
      status: signatureValid ? "received" : "rejected",
      lastError: signatureValid ? null : "Firma inválida o ausente",
    })
    .onConflictDoNothing({ target: webhookEvents.dedupeKey })
    .returning();
  if (row) return { id: row.id, duplicate: false };
  const [existing] = await db.select().from(webhookEvents).where(eq(webhookEvents.dedupeKey, dedupeKey));
  return { id: existing.id, duplicate: true };
}

async function attemptForResource(topic: string, resourceId: string): Promise<{ attemptId: string | null; externalReference: string | null }> {
  const gw = await requireGateway();
  if (topic === "order") {
    const [byRef] = await db.select().from(paymentAttempts).where(eq(paymentAttempts.providerRef, resourceId));
    if (byRef) return { attemptId: byRef.id, externalReference: byRef.id };
    const st = await gw.getOrder(resourceId);
    return { attemptId: st.externalReference, externalReference: st.externalReference };
  }
  const p = await gw.getPayment(resourceId);
  return { attemptId: p.externalReference, externalReference: p.externalReference };
}

/** Procesa un evento guardado: siempre consulta el recurso oficial; nunca confía en el cuerpo recibido. */
export async function processWebhookEvent(eventId: string) {
  const [ev] = await db.select().from(webhookEvents).where(eq(webhookEvents.id, eventId));
  if (!ev || !ev.signatureValid || ev.status === "processed" || ev.status === "ignored") return ev?.status ?? "missing";
  try {
    if (ev.topic !== "order" && ev.topic !== "payment") {
      await db.update(webhookEvents).set({ status: "ignored", processedAt: new Date(), lastError: `Tópico ${ev.topic} no utilizado` }).where(eq(webhookEvents.id, ev.id));
      return "ignored";
    }
    const { attemptId } = await attemptForResource(ev.topic, ev.resourceId);
    const [attempt] = attemptId && /^[0-9a-f-]{36}$/.test(attemptId) ? await db.select().from(paymentAttempts).where(eq(paymentAttempts.id, attemptId)) : [];
    if (!attempt) {
      await db.update(webhookEvents).set({ status: "ignored", processedAt: new Date(), lastError: "Recurso sin intento conocido en esta tienda" }).where(eq(webhookEvents.id, ev.id));
      return "ignored";
    }
    if (attempt.method === "card") {
      await reconcileAttempt(attempt.id);
    } else {
      const gw = await requireGateway();
      const [one, all] = await Promise.all([ev.topic === "payment" ? gw.getPayment(ev.resourceId) : null, gw.findPaymentsByExternalReference(attempt.id)]);
      const merged = [...all];
      if (one && !merged.some((p) => p.providerPaymentId === one.providerPaymentId)) merged.push(one);
      await applyProviderState(attempt.id, { kind: "payments", providerRef: attempt.providerRef, status: aggregatePayments(merged), statusDetail: null, externalReference: attempt.id, amountCents: null, currency: null, collectorId: null, payments: merged, challengeUrl: null }, "webhook");
    }
    await db.update(webhookEvents).set({ status: "processed", processedAt: new Date(), attempts: ev.attempts + 1, lastError: null }).where(eq(webhookEvents.id, ev.id));
    return "processed";
  } catch (e) {
    const attempts = ev.attempts + 1;
    await db
      .update(webhookEvents)
      .set({ status: "failed", attempts, lastError: String((e as Error).message).slice(0, 500), nextAttemptAt: new Date(Date.now() + Math.min(2 ** attempts, 120) * 60_000) })
      .where(eq(webhookEvents.id, ev.id));
    return "failed";
  }
}

export async function retryFailedWebhooks(limit = 20) {
  const rows = await db
    .select({ id: webhookEvents.id })
    .from(webhookEvents)
    .where(and(eq(webhookEvents.signatureValid, true), or(eq(webhookEvents.status, "received"), and(eq(webhookEvents.status, "failed"), lte(webhookEvents.nextAttemptAt, new Date()))), lte(webhookEvents.attempts, 12)))
    .orderBy(asc(webhookEvents.receivedAt))
    .limit(limit);
  const results = [];
  for (const r of rows) results.push(await processWebhookEvent(r.id));
  return results;
}

