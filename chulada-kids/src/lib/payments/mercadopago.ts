import "server-only";
import { MercadoPagoConfig, Order, Payment, PaymentRefund, Preference } from "mercadopago";
import { centsToDecimalString, decimalToCents } from "../money";
import { aggregatePayments, mapOrderStatus, mapPaymentStatus } from "./status";
import {
  GatewayAuthError,
  GatewayRejectedError,
  GatewayTimeoutError,
  type CardPaymentInput,
  type PaymentGateway,
  type PreferenceInput,
  type ProviderPayment,
  type ProviderState,
} from "./types";

/* eslint-disable @typescript-eslint/no-explicit-any */

const toCents = (v: unknown): number => (v == null || v === "" ? 0 : decimalToCents(typeof v === "number" ? v : String(v)));

function classify(e: unknown): never {
  const err = e as { status?: number; name?: string; message?: string; causes?: unknown[] };
  if (err?.name === "MPConnectionError" || err?.status === 0 || err?.status === 408 || (err?.status ?? 0) >= 500 || err?.name === "AbortError") {
    throw new GatewayTimeoutError(err?.message ?? "Tiempo de espera agotado");
  }
  if (err?.status === 401) throw new GatewayAuthError("Credenciales de Mercado Pago inválidas o revocadas");
  if (err?.status === 402) throw new GatewayRejectedError(err.message ?? "Pago rechazado", err.message ?? "rejected");
  throw e;
}

/** Orders API → estado normalizado. */
export function normalizeOrder(o: any): ProviderState {
  const payments: ProviderPayment[] = (o?.transactions?.payments ?? []).map((p: any) => ({
    providerPaymentId: String(p.id),
    status: mapOrderStatus(p.status, p.status_detail),
    statusDetail: p.status_detail ?? null,
    amountCents: toCents(p.amount),
    refundedCents: toCents(p.refunded_amount),
    currency: o.currency ?? "ARS",
    collectorId: o.user_id != null ? String(o.user_id) : null,
    externalReference: o.external_reference ?? null,
    installments: p.payment_method?.installments ?? null,
    paymentMethodId: p.payment_method?.id ?? null,
    dateOfExpiration: p.date_of_expiration ? new Date(p.date_of_expiration) : null,
  }));
  const challengeUrl = (o?.transactions?.payments ?? []).map((p: any) => p.payment_method?.transaction_security?.url).find(Boolean) ?? null;
  return {
    kind: "order",
    providerRef: o?.id ? String(o.id) : null,
    status: mapOrderStatus(o?.status, o?.status_detail),
    statusDetail: o?.status_detail ?? null,
    externalReference: o?.external_reference ?? null,
    amountCents: o?.total_amount != null ? toCents(o.total_amount) : null,
    currency: o?.currency ?? null,
    collectorId: o?.user_id != null ? String(o.user_id) : null,
    payments,
    challengeUrl,
  };
}

/** Payments API → pago normalizado. */
export function normalizePayment(p: any): ProviderPayment {
  const amount = toCents(p.transaction_amount);
  const refunded = toCents(p.transaction_amount_refunded);
  return {
    providerPaymentId: String(p.id),
    status: mapPaymentStatus(p.status, refunded, amount),
    statusDetail: p.status_detail ?? null,
    amountCents: amount,
    refundedCents: refunded,
    currency: p.currency_id ?? "",
    collectorId: p.collector_id != null ? String(p.collector_id) : null,
    externalReference: p.external_reference ?? null,
    installments: p.installments ?? null,
    paymentMethodId: p.payment_method_id ?? null,
    dateOfExpiration: p.date_of_expiration ? new Date(p.date_of_expiration) : null,
  };
}

export class MercadoPagoGateway implements PaymentGateway {
  readonly driver = "mercadopago" as const;
  private config: MercadoPagoConfig;

  constructor(
    accessToken: string,
    readonly environment: "test" | "production",
    readonly publicKey: string | null,
    readonly collectorId: string | null,
  ) {
    this.config = new MercadoPagoConfig({ accessToken, options: { timeout: 20000 } });
  }

  async createCardOrder(input: CardPaymentInput): Promise<ProviderState> {
    const threeDs = process.env.MP_3DS_VALIDATION; // "on_fraud_risk" | "always" | vacío (a validar con la doc vigente)
    const amount = centsToDecimalString(input.amountCents);
    try {
      const res = await new Order(this.config).create({
        body: {
          type: "online",
          processing_mode: "automatic",
          total_amount: amount,
          external_reference: input.externalReference,
          description: input.description,
          payer: {
            email: input.payerEmail,
            ...(input.payerIdentification ? { identification: { type: input.payerIdentification.type, number: input.payerIdentification.number } } : {}),
          },
          transactions: {
            payments: [
              {
                amount,
                payment_method: {
                  id: input.paymentMethodId,
                  type: input.paymentTypeId,
                  token: input.token,
                  installments: input.installments,
                  statement_descriptor: process.env.MP_STATEMENT_DESCRIPTOR || undefined,
                  ...(threeDs === "on_fraud_risk" || threeDs === "always" ? { transaction_security: { validation: threeDs, liability_shift: "required" } } : {}),
                },
              },
            ],
          },
        },
        requestOptions: { idempotencyKey: input.idempotencyKey },
      });
      return normalizeOrder(res);
    } catch (e) {
      classify(e);
    }
  }

  async getOrder(id: string) {
    try {
      return normalizeOrder(await new Order(this.config).get({ id }));
    } catch (e) {
      classify(e);
    }
  }

  async findOrderByExternalReference(ref: string, since: Date) {
    try {
      const res = await new Order(this.config).search({
        options: { external_reference: ref, begin_date: new Date(since.getTime() - 3600_000).toISOString(), end_date: new Date(Date.now() + 3600_000).toISOString() },
      });
      const o = res.data?.[0];
      return o ? normalizeOrder(o) : null;
    } catch (e) {
      classify(e);
    }
  }

  async cancelOrder(id: string) {
    try {
      return normalizeOrder(await new Order(this.config).cancel({ id }));
    } catch (e) {
      classify(e);
    }
  }

  async refundOrder(id: string, amountCents: number | null, paymentId: string | null) {
    try {
      const body = amountCents != null && paymentId ? { transactions: [{ id: paymentId, amount: centsToDecimalString(amountCents) }] } : undefined;
      return normalizeOrder(await new Order(this.config).refund({ id, body }));
    } catch (e) {
      classify(e);
    }
  }

  async createPreference(input: PreferenceInput) {
    try {
      const res = await new Preference(this.config).create({
        body: {
          items: [{ id: input.externalReference, title: input.title, quantity: 1, unit_price: input.amountCents / 100, currency_id: "ARS" }],
          external_reference: input.externalReference,
          payer: { email: input.payerEmail },
          back_urls: { success: input.backUrl, pending: input.backUrl, failure: input.backUrl },
          auto_return: "approved",
          notification_url: input.notificationUrl,
          purpose: "wallet_purchase",
          expires: true,
          expiration_date_to: input.expiresAt.toISOString(),
          statement_descriptor: process.env.MP_STATEMENT_DESCRIPTOR || undefined,
          binary_mode: false,
        },
        requestOptions: { idempotencyKey: input.idempotencyKey },
      });
      if (!res.id) throw new Error("Mercado Pago no devolvió el id de la preferencia");
      return { preferenceId: res.id, initPoint: (this.environment === "test" ? res.sandbox_init_point : res.init_point) ?? res.init_point ?? null };
    } catch (e) {
      classify(e);
    }
  }

  async expirePreference(id: string) {
    try {
      const client = new Preference(this.config);
      const current = await client.get({ preferenceId: id });
      await client.update({ id, updatePreferenceRequest: { items: current.items ?? [], expires: true, expiration_date_to: new Date(Date.now() - 60_000).toISOString() } });
    } catch (e) {
      classify(e);
    }
  }

  async getPayment(id: string) {
    try {
      return normalizePayment(await new Payment(this.config).get({ id }));
    } catch (e) {
      classify(e);
    }
  }

  async findPaymentsByExternalReference(ref: string) {
    try {
      const res = await new Payment(this.config).search({ options: { external_reference: ref, sort: "date_created", criteria: "desc" } });
      return (res.results ?? []).map(normalizePayment);
    } catch (e) {
      classify(e);
    }
  }

  async refundPayment(id: string, amountCents: number | null) {
    try {
      const refunds = new PaymentRefund(this.config);
      if (amountCents == null) await refunds.total({ payment_id: id });
      else await refunds.create({ payment_id: id, body: { amount: amountCents / 100 } });
      return this.getPayment(id);
    } catch (e) {
      classify(e);
    }
  }
}

export { aggregatePayments };
