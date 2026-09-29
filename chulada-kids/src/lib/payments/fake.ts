import "server-only";
import { createHmac, randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "../db";
import { fakeProviderObjects } from "../db/schema";
import { centsToDecimalString } from "../money";
import { env } from "../env";
import { normalizeOrder, normalizePayment } from "./mercadopago";
import {
  GatewayTimeoutError,
  type CardPaymentInput,
  type PaymentGateway,
  type PreferenceInput,
  type ProviderPayment,
  type ProviderState,
} from "./types";

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * SIMULADOR LOCAL DE PAGOS — NO ES MERCADO PAGO.
 * Imita la forma de las respuestas de Orders API y Payments API para probar el flujo completo
 * (aprobado, rechazado, pendiente, 3DS, timeout, webhooks duplicados/fuera de orden).
 * Solo se habilita fuera de producción con ALLOW_FAKE_PAYMENTS=true (ver env.paymentsDriver).
 */
export const FAKE_COLLECTOR_ID = "fake-collector-0001";

export type FakeScenario = "approve" | "reject" | "pending" | "challenge" | "timeout";

async function save(id: string, kind: "order" | "preference" | "payment", data: any, externalReference: string | null) {
  await db
    .insert(fakeProviderObjects)
    .values({ id, kind, data, externalReference })
    .onConflictDoUpdate({ target: fakeProviderObjects.id, set: { data, updatedAt: new Date() } });
}

async function load(id: string, kind: "order" | "preference" | "payment") {
  const [row] = await db.select().from(fakeProviderObjects).where(and(eq(fakeProviderObjects.id, id), eq(fakeProviderObjects.kind, kind)));
  return row?.data as any;
}

/** Envía un webhook firmado igual que MP (x-signature: ts=…,v1=HMAC(id:…;request-id:…;ts:…;)). */
export async function emitFakeWebhook(type: "order" | "payment", dataId: string, opts: { requestId?: string; secret?: string } = {}) {
  const secret = opts.secret ?? env.mpWebhookSecret;
  const requestId = opts.requestId ?? randomUUID();
  const ts = Math.floor(Date.now() / 1000).toString();
  const manifest = `id:${dataId};request-id:${requestId};ts:${ts};`;
  const v1 = createHmac("sha256", secret).update(manifest).digest("hex");
  const url = `${env.appUrl}/api/webhooks/mercadopago?data.id=${encodeURIComponent(dataId)}&type=${type}`;
  return fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", "x-signature": `ts=${ts},v1=${v1}`, "x-request-id": requestId },
    body: JSON.stringify({ action: `${type}.updated`, type, data: { id: dataId }, live_mode: false }),
  }).catch(() => null);
}

function scenarioFromToken(token: string): FakeScenario {
  const s = token.replace(/^fake:/, "");
  return (["approve", "reject", "pending", "challenge", "timeout"] as const).includes(s as FakeScenario) ? (s as FakeScenario) : "reject";
}

export class FakeGateway implements PaymentGateway {
  readonly driver = "fake" as const;
  readonly environment = "test" as const;
  readonly publicKey = "FAKE-PUBLIC-KEY";
  readonly collectorId = FAKE_COLLECTOR_ID;

  async createCardOrder(input: CardPaymentInput): Promise<ProviderState> {
    // Idempotencia como el proveedor: misma clave → mismo recurso.
    const [existing] = await db
      .select()
      .from(fakeProviderObjects)
      .where(and(eq(fakeProviderObjects.kind, "order"), eq(fakeProviderObjects.externalReference, input.externalReference)));
    if (existing && (existing.data as any).idempotency_key === input.idempotencyKey) return normalizeOrder(existing.data);

    const scenario = scenarioFromToken(input.token);
    const id = `FAKEORD${Date.now()}${Math.floor(Math.random() * 1000)}`;
    const payId = `FAKEPAYORD${Date.now()}${Math.floor(Math.random() * 1000)}`;
    const amount = centsToDecimalString(input.amountCents);
    const map: Record<FakeScenario, [string, string, string, string]> = {
      approve: ["processed", "accredited", "processed", "accredited"],
      reject: ["failed", "failed", "failed", "cc_rejected_insufficient_amount"],
      pending: ["processing", "in_process", "processing", "pending_review_manual"],
      challenge: ["action_required", "pending_challenge", "action_required", "pending_challenge"],
      timeout: ["processed", "accredited", "processed", "accredited"],
    };
    const [os, osd, ps, psd] = map[scenario];
    const order = {
      id,
      type: "online",
      idempotency_key: input.idempotencyKey,
      external_reference: input.externalReference,
      status: os,
      status_detail: osd,
      total_amount: amount,
      currency: "ARS",
      user_id: FAKE_COLLECTOR_ID,
      created_date: new Date().toISOString(),
      transactions: {
        payments: [
          {
            id: payId,
            amount,
            status: ps,
            status_detail: psd,
            payment_method: {
              id: input.paymentMethodId,
              type: input.paymentTypeId,
              installments: input.installments,
              ...(scenario === "challenge" ? { transaction_security: { url: `${env.appUrl}/checkout/simulador-3ds?order=${id}`, type: "challenge", status: "pending" } } : {}),
            },
          },
        ],
      },
    };
    await save(id, "order", order, input.externalReference);
    if (scenario === "timeout") {
      // El proveedor procesó, pero la respuesta "se perdió": solo la conciliación o el webhook lo revelan.
      setTimeout(() => void emitFakeWebhook("order", id), 1500);
      throw new GatewayTimeoutError("Simulador: tiempo de espera agotado");
    }
    setTimeout(() => void emitFakeWebhook("order", id), 300);
    return normalizeOrder(order);
  }

  async getOrder(id: string) {
    const o = await load(id, "order");
    if (!o) throw new Error("Order no encontrada (simulador)");
    return normalizeOrder(o);
  }

  async findOrderByExternalReference(ref: string) {
    const [row] = await db.select().from(fakeProviderObjects).where(and(eq(fakeProviderObjects.kind, "order"), eq(fakeProviderObjects.externalReference, ref)));
    return row ? normalizeOrder(row.data) : null;
  }

  async cancelOrder(id: string) {
    const o = await load(id, "order");
    if (!o) throw new Error("Order no encontrada (simulador)");
    if (o.status === "processed") return normalizeOrder(o);
    o.status = "cancelled";
    o.status_detail = "cancelled";
    for (const p of o.transactions.payments) {
      p.status = "cancelled";
      p.status_detail = "cancelled";
    }
    await save(id, "order", o, o.external_reference);
    return normalizeOrder(o);
  }

  async refundOrder(id: string, amountCents: number | null) {
    const o = await load(id, "order");
    if (!o) throw new Error("Order no encontrada (simulador)");
    const p = o.transactions.payments[0];
    const total = Math.round(Number(p.amount) * 100);
    const prev = Math.round(Number(p.refunded_amount ?? 0) * 100);
    const refund = amountCents ?? total - prev;
    const newRefunded = Math.min(total, prev + refund);
    p.refunded_amount = centsToDecimalString(newRefunded);
    const full = newRefunded >= total;
    o.status = full ? "refunded" : "processed";
    o.status_detail = full ? "refunded" : "partially_refunded";
    p.status = o.status;
    p.status_detail = o.status_detail;
    await save(id, "order", o, o.external_reference);
    return normalizeOrder(o);
  }

  async createPreference(input: PreferenceInput) {
    const id = `FAKEPREF-${randomUUID()}`;
    await save(id, "preference", { id, external_reference: input.externalReference, amount: input.amountCents, back_url: input.backUrl, title: input.title, expires_at: input.expiresAt.toISOString() }, input.externalReference);
    return { preferenceId: id, initPoint: `${env.appUrl}/checkout/simulador-mp?pref=${encodeURIComponent(id)}` };
  }

  async expirePreference(id: string) {
    const pref = await load(id, "preference");
    if (!pref) return;
    pref.expires_at = new Date(Date.now() - 60_000).toISOString();
    await save(id, "preference", pref, pref.external_reference);
  }

  async getPayment(id: string) {
    const p = await load(id, "payment");
    if (!p) throw new Error("Pago no encontrado (simulador)");
    return normalizePayment(p);
  }

  async findPaymentsByExternalReference(ref: string) {
    const rows = await db.select().from(fakeProviderObjects).where(and(eq(fakeProviderObjects.kind, "payment"), eq(fakeProviderObjects.externalReference, ref)));
    return rows.map((r) => normalizePayment(r.data));
  }

  async refundPayment(id: string, amountCents: number | null): Promise<ProviderPayment> {
    const p = await load(id, "payment");
    if (!p) throw new Error("Pago no encontrado (simulador)");
    const total = Math.round(p.transaction_amount * 100);
    const prev = Math.round((p.transaction_amount_refunded ?? 0) * 100);
    const next = Math.min(total, prev + (amountCents ?? total - prev));
    p.transaction_amount_refunded = next / 100;
    p.status = next >= total ? "refunded" : "approved";
    await save(id, "payment", p, p.external_reference);
    return normalizePayment(p);
  }

  // ── Acciones del "entorno del proveedor" simulado (páginas /checkout/simulador-*) ──

  static async payPreference(prefId: string, outcome: "approved" | "rejected" | "pending") {
    const pref = await load(prefId, "preference");
    if (!pref) throw new Error("Preferencia inexistente");
    if (new Date(pref.expires_at) < new Date()) throw new Error("La preferencia venció y ya no puede pagarse.");
    const id = `FAKEPAY${Date.now()}${Math.floor(Math.random() * 1000)}`;
    const payment = {
      id,
      status: outcome === "pending" ? "pending" : outcome,
      status_detail: outcome === "approved" ? "accredited" : outcome === "pending" ? "pending_waiting_payment" : "cc_rejected_other_reason",
      transaction_amount: pref.amount / 100,
      transaction_amount_refunded: 0,
      currency_id: "ARS",
      collector_id: FAKE_COLLECTOR_ID,
      external_reference: pref.external_reference,
      payment_method_id: "account_money",
      installments: 1,
      date_of_expiration: outcome === "pending" ? new Date(Date.now() + 3 * 86400_000).toISOString() : null,
    };
    await save(id, "payment", payment, pref.external_reference);
    await emitFakeWebhook("payment", id);
    return { paymentId: id, backUrl: pref.back_url as string, externalReference: pref.external_reference as string };
  }

  static async completeChallenge(orderId: string, ok: boolean) {
    const o = await load(orderId, "order");
    if (!o) throw new Error("Order inexistente");
    o.status = ok ? "processed" : "failed";
    o.status_detail = ok ? "accredited" : "failed";
    for (const p of o.transactions.payments) {
      p.status = ok ? "processed" : "failed";
      p.status_detail = ok ? "accredited" : "cc_rejected_3ds_challenge";
      if (p.payment_method?.transaction_security) p.payment_method.transaction_security.status = "complete";
    }
    await save(orderId, "order", o, o.external_reference);
    await emitFakeWebhook("order", orderId);
    return o.external_reference as string;
  }

  /** Para pruebas: aprobar un pago pendiente, o crear un segundo pago aprobado (pago duplicado). */
  static async setPaymentStatus(paymentId: string, status: string) {
    const p = await load(paymentId, "payment");
    p.status = status;
    await save(paymentId, "payment", p, p.external_reference);
  }
}
