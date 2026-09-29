import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { orders, paymentAttempts } from "@/lib/db/schema";
import { jsonError, jsonOk } from "@/lib/http";
import { refreshOrderPayment, describeAttempt } from "@/lib/payments/service";
import { orderFromRequest } from "@/lib/checkout-http";
import { PAYMENT_STATUS_LABEL } from "@/lib/payments/status";

/** Estado real del pago (consulta al proveedor si hay intentos en curso). Nunca usa parámetros de retorno. */
export async function GET(req: Request, ctx: RouteContext<"/api/checkout/[orderId]/status">) {
  const { orderId } = await ctx.params;
  const access = await orderFromRequest(req, orderId);
  if (!access) return jsonError("Pedido no encontrado.", 404);
  await refreshOrderPayment(orderId).catch(() => null);
  const [o] = await db.select().from(orders).where(eq(orders.id, orderId));
  const attemptId = new URL(req.url).searchParams.get("intento");
  let attempt = null;
  if (attemptId && /^[0-9a-f-]{36}$/.test(attemptId)) {
    // Solo se describe un intento que pertenezca a este pedido.
    const [a] = await db.select({ id: paymentAttempts.id }).from(paymentAttempts).where(and(eq(paymentAttempts.id, attemptId), eq(paymentAttempts.orderId, orderId)));
    if (a) attempt = await describeAttempt(a.id).catch(() => null);
  }
  return jsonOk({ paymentStatus: o.paymentStatus, label: PAYMENT_STATUS_LABEL[o.paymentStatus], attempt, totalCents: o.totalCents });
}
