import { getCurrentUser } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { audit } from "@/lib/audit";
import { toCsv } from "@/lib/csv";
import { listOrders, parseOrderFilters } from "@/lib/orders/admin-list";
import { orderNumber } from "@/lib/orders/access";
import { formatStoreDateTime } from "@/lib/time";
import { FULFILLMENT_LABEL, type FulfillmentStatus } from "@/lib/orders/status";
import { PAYMENT_STATUS_LABEL } from "@/lib/payments/status";

/** Exportación CSV limitada a quien tiene permiso de pedidos. Sin notas internas ni datos de pago. */
export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user || !can(user.role, "orders:export")) return new Response("No autorizado", { status: 403 });
  const sp = Object.fromEntries(new URL(req.url).searchParams);
  const rows = await listOrders(parseOrderFilters(sp), 5000);
  const csv = toCsv([
    ["Pedido", "Fecha", "Cliente", "Email", "Teléfono", "Entrega", "Subtotal", "Descuentos", "Envío", "Total", "Pago", "Estado"],
    ...rows.map(({ o }) => [
      orderNumber(o.number),
      formatStoreDateTime(o.createdAt),
      o.customerName,
      o.email,
      o.phone,
      o.shipping.name,
      (o.subtotalCents / 100).toFixed(2),
      ((o.promotionDiscountCents + o.couponDiscountCents) / 100).toFixed(2),
      (o.shippingCents / 100).toFixed(2),
      (o.totalCents / 100).toFixed(2),
      PAYMENT_STATUS_LABEL[o.paymentStatus],
      FULFILLMENT_LABEL[o.fulfillmentStatus as FulfillmentStatus],
    ]),
  ]);
  await audit(user.id, "orders.export", "order", null, { count: rows.length, filters: sp });
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="pedidos-${new Date().toISOString().slice(0, 10)}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
