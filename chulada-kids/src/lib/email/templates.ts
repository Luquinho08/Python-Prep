import { formatARS } from "../money";

type Line = { productName: string; variantName: string; quantity: number; lineTotalCents: number; personalization: { label: string; display: string }[] };

export function orderPaidCustomerEmail(o: { number: string; name: string; totalCents: number; link: string; shippingName: string; productionDaysMax: number }, lines: Line[]) {
  const items = lines
    .map((l) => `• ${l.productName} (${l.variantName}) × ${l.quantity} — ${formatARS(l.lineTotalCents)}${l.personalization.length ? `\n   ${l.personalization.map((p) => `${p.label}: ${p.display}`).join(" · ")}` : ""}`)
    .join("\n");
  return {
    subject: `Recibimos tu pago — pedido ${o.number}`,
    text: `¡Hola ${o.name}!\n\nMercado Pago aprobó el pago de tu pedido ${o.number} por ${formatARS(o.totalCents)}.\n\n${items}\n\nEntrega: ${o.shippingName}.\n${o.productionDaysMax > 0 ? `Elaboración estimada: hasta ${o.productionDaysMax} días hábiles; el plazo de entrega se suma después.\n` : ""}\nSeguimiento del pedido (enlace personal, no lo compartas):\n${o.link}\n\nGracias por elegir Chulada Kids.`,
  };
}

export function orderPaidAdminEmail(o: { number: string; name: string; email: string; totalCents: number; adminLink: string }) {
  return {
    subject: `Nuevo pedido pagado ${o.number} (${formatARS(o.totalCents)})`,
    text: `${o.name} <${o.email}> pagó el pedido ${o.number} por ${formatARS(o.totalCents)}.\nVer en el panel: ${o.adminLink}`,
  };
}

export function incidentAdminEmail(kind: string, orderNumber: string, details: string, adminLink: string) {
  return {
    subject: `Incidencia en pedido ${orderNumber}: ${kind}`,
    text: `Se abrió una incidencia (${kind}) en el pedido ${orderNumber}.\n${details}\n\nRevisar: ${adminLink}`,
  };
}

export function orderStatusEmail(o: { number: string; name: string; statusLabel: string; message?: string | null; link: string }) {
  return {
    subject: `Tu pedido ${o.number}: ${o.statusLabel}`,
    text: `Hola ${o.name}.\n\nTu pedido ${o.number} ahora está: ${o.statusLabel}.\n${o.message ? `\n${o.message}\n` : ""}\nSeguimiento: ${o.link}`,
  };
}
