import type { InternalPaymentStatus, ProviderPayment } from "./types";

/**
 * Mapeo de estados de Orders API → interno. (A validar con el sandbox de MP: ver DECISIONS D-08.)
 * Desconocido → to_verify (nunca "rechazado" automático).
 */
export function mapOrderStatus(status: string | undefined | null, detail: string | undefined | null): InternalPaymentStatus {
  const s = (status ?? "").toLowerCase();
  const d = (detail ?? "").toLowerCase();
  if (s === "processed") {
    if (d === "accredited" || d === "") return "approved";
    if (d.includes("partially_refunded")) return "partially_refunded";
    return "approved";
  }
  if (s === "action_required") return "requires_action";
  if (s === "failed") return "rejected";
  if (s === "processing" || s === "created" || s === "pending") return "pending";
  if (s === "cancelled" || s === "canceled") return "cancelled";
  if (s === "expired") return "expired";
  if (s === "refunded") return d.includes("partially") ? "partially_refunded" : "refunded";
  if (s === "charged_back" || s === "chargeback") return "charged_back";
  return "to_verify";
}

/** Payments API (Checkout Pro / Wallet) → interno. Solo "approved" confirma el cobro. */
export function mapPaymentStatus(status: string | undefined | null, refundedCents = 0, amountCents = 0): InternalPaymentStatus {
  switch ((status ?? "").toLowerCase()) {
    case "approved":
      return refundedCents > 0 && refundedCents < amountCents ? "partially_refunded" : "approved";
    case "authorized":
    case "pending":
    case "in_process":
    case "in_mediation":
      return "pending";
    case "rejected":
      return "rejected";
    case "cancelled":
      return "cancelled";
    case "refunded":
      return refundedCents > 0 && refundedCents < amountCents ? "partially_refunded" : "refunded";
    case "charged_back":
      return "charged_back";
    default:
      return "to_verify";
  }
}

/** Estados en los que un intento todavía puede terminar cobrándose: hay que conciliar antes de iniciar otro. */
export const IN_FLIGHT: InternalPaymentStatus[] = ["pending", "requires_action", "to_verify"];
export const FINAL_OK: InternalPaymentStatus[] = ["approved", "partially_refunded", "refunded", "charged_back"];

/** Estado agregado de un conjunto de pagos (una preferencia puede tener varios intentos). */
export function aggregatePayments(payments: ProviderPayment[]): InternalPaymentStatus {
  if (payments.length === 0) return "pending";
  const order: InternalPaymentStatus[] = ["charged_back", "refunded", "partially_refunded", "approved", "requires_action", "pending", "to_verify", "rejected", "cancelled", "expired"];
  for (const s of order) if (payments.some((p) => p.status === s)) return s;
  return "to_verify";
}

export const PAYMENT_STATUS_LABEL: Record<string, string> = {
  unpaid: "Sin pagar",
  pending: "Pago pendiente",
  requires_action: "Requiere autenticación",
  approved: "Pagado",
  rejected: "Pago rechazado",
  cancelled: "Pago cancelado",
  expired: "Vencido",
  refunded: "Reembolsado",
  partially_refunded: "Reembolso parcial",
  charged_back: "Contracargo",
  to_verify: "Pago por verificar",
};

/** Mensajes honestos para el comprador según status_detail conocidos (lista no exhaustiva). */
export function rejectionMessage(detail: string | null | undefined): string {
  const d = (detail ?? "").toLowerCase();
  if (d.includes("insufficient")) return "La tarjeta no tiene fondos suficientes. Probá con otra tarjeta o medio de pago.";
  if (d.includes("security_code") || d.includes("bad_filled")) return "Revisá los datos de la tarjeta e intentá de nuevo.";
  if (d.includes("call_for_authorize")) return "Tu banco necesita que autorices el pago. Comunicate con el emisor o usá otro medio.";
  if (d.includes("high_risk") || d.includes("blacklist")) return "El pago no pudo procesarse. Probá con otro medio de pago.";
  if (d.includes("duplicated")) return "Ya hay un pago igual reciente. Revisá tu resumen antes de reintentar.";
  return "El pago fue rechazado. Podés intentar con otra tarjeta o con tu cuenta de Mercado Pago.";
}
