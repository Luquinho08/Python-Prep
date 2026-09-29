export type FulfillmentStatus =
  | "awaiting_payment"
  | "received"
  | "awaiting_data"
  | "awaiting_approval"
  | "in_production"
  | "ready"
  | "shipped"
  | "picked_up"
  | "delivered"
  | "cancelled";

export const FULFILLMENT_LABEL: Record<FulfillmentStatus, string> = {
  awaiting_payment: "Esperando pago",
  received: "Recibido",
  awaiting_data: "Pendiente de datos o diseño",
  awaiting_approval: "Esperando aprobación del diseño",
  in_production: "En producción",
  ready: "Listo para entregar",
  shipped: "Enviado",
  picked_up: "Retirado",
  delivered: "Entregado",
  cancelled: "Cancelado",
};

/** Transiciones operativas permitidas (la cancelación pasa por el flujo del propietario). */
export const NEXT_STATES: Record<FulfillmentStatus, FulfillmentStatus[]> = {
  awaiting_payment: [],
  received: ["awaiting_data", "awaiting_approval", "in_production"],
  awaiting_data: ["awaiting_approval", "in_production"],
  awaiting_approval: ["awaiting_data", "in_production"],
  in_production: ["ready"],
  ready: ["shipped", "picked_up"],
  shipped: ["delivered"],
  picked_up: [],
  delivered: [],
  cancelled: [],
};

export function transitionProblem(opts: {
  from: FulfillmentStatus;
  to: FulfillmentStatus;
  paymentStatus: string;
  requiresApproval: boolean;
  hasApprovedProof: boolean;
  shippingKind: "pickup" | "delivery";
}): string | null {
  if (!NEXT_STATES[opts.from].includes(opts.to)) return `No se puede pasar de “${FULFILLMENT_LABEL[opts.from]}” a “${FULFILLMENT_LABEL[opts.to]}”.`;
  const paid = ["approved", "partially_refunded"].includes(opts.paymentStatus);
  if (!paid) return "El pago no está aprobado: no se puede avanzar la producción.";
  if (opts.to === "in_production" && opts.requiresApproval && !opts.hasApprovedProof) return "Este pedido requiere un diseño aprobado por el cliente antes de producir.";
  if (opts.to === "shipped" && opts.shippingKind === "pickup") return "El pedido es para retiro: usá “Retirado”.";
  if (opts.to === "picked_up" && opts.shippingKind === "delivery") return "El pedido es con envío: usá “Enviado”.";
  return null;
}
