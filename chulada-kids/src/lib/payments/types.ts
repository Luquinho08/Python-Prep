export type InternalPaymentStatus =
  | "pending"
  | "requires_action"
  | "approved"
  | "rejected"
  | "cancelled"
  | "expired"
  | "refunded"
  | "partially_refunded"
  | "charged_back"
  | "to_verify";

export type ProviderPayment = {
  providerPaymentId: string;
  status: InternalPaymentStatus;
  statusDetail: string | null;
  amountCents: number;
  refundedCents: number;
  currency: string;
  collectorId: string | null;
  externalReference: string | null;
  installments: number | null;
  paymentMethodId: string | null;
  dateOfExpiration: Date | null;
};

/** Estado normalizado de un recurso del proveedor (order de Orders API o conjunto de pagos de una preferencia). */
export type ProviderState = {
  kind: "order" | "payments";
  providerRef: string | null;
  status: InternalPaymentStatus;
  statusDetail: string | null;
  externalReference: string | null;
  amountCents: number | null;
  currency: string | null;
  collectorId: string | null;
  payments: ProviderPayment[];
  challengeUrl: string | null;
};

export type CardPaymentInput = {
  externalReference: string;
  idempotencyKey: string;
  amountCents: number;
  token: string;
  paymentMethodId: string;
  paymentTypeId: string;
  installments: number;
  payerEmail: string;
  payerIdentification?: { type: string; number: string } | null;
  description: string;
};

export type PreferenceInput = {
  externalReference: string;
  idempotencyKey: string;
  amountCents: number;
  title: string;
  payerEmail: string;
  backUrl: string;
  notificationUrl: string;
  expiresAt: Date;
};

export class GatewayTimeoutError extends Error {}
export class GatewayRejectedError extends Error {
  constructor(message: string, public detail: string) {
    super(message);
  }
}
export class GatewayConfigError extends Error {}
export class GatewayAuthError extends Error {}

export interface PaymentGateway {
  readonly driver: "mercadopago" | "fake";
  readonly environment: "test" | "production";
  readonly publicKey: string | null;
  readonly collectorId: string | null;
  createCardOrder(input: CardPaymentInput): Promise<ProviderState>;
  getOrder(providerOrderId: string): Promise<ProviderState>;
  findOrderByExternalReference(ref: string, since: Date): Promise<ProviderState | null>;
  cancelOrder(providerOrderId: string): Promise<ProviderState>;
  refundOrder(providerOrderId: string, amountCents: number | null, paymentId: string | null): Promise<ProviderState>;
  createPreference(input: PreferenceInput): Promise<{ preferenceId: string; initPoint: string | null }>;
  /** Vence una preferencia para que no pueda pagarse más (al cambiar de método o reemplazar el pedido). */
  expirePreference(preferenceId: string): Promise<void>;
  getPayment(paymentId: string): Promise<ProviderPayment>;
  findPaymentsByExternalReference(ref: string): Promise<ProviderPayment[]>;
  refundPayment(paymentId: string, amountCents: number | null): Promise<ProviderPayment>;
}
