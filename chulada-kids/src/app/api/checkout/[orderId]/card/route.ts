import { z } from "zod";
import { jsonError, jsonOk, sameOrigin } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";
import { clientIp } from "@/lib/request";
import { startCardPayment } from "@/lib/payments/service";
import { flowErrorResponse, orderFromRequest } from "@/lib/checkout-http";

// Solo datos NO sensibles: el número y el código de seguridad nunca llegan a este servidor (los tokeniza el Brick).
const schema = z.object({
  token: z.string().min(5).max(200),
  payment_method_id: z.string().min(2).max(40),
  paymentTypeId: z.enum(["credit_card", "debit_card", "prepaid_card"]),
  issuer_id: z.union([z.string(), z.number()]).optional().nullable(),
  installments: z.number().int().min(1).max(36),
  transaction_amount: z.number().positive(),
  payer: z
    .object({
      email: z.string().email().optional(),
      identification: z.object({ type: z.string().max(10), number: z.string().max(20) }).optional().nullable(),
    })
    .optional(),
});

export async function POST(req: Request, ctx: RouteContext<"/api/checkout/[orderId]/card">) {
  if (!sameOrigin(req)) return jsonError("Origen no permitido.", 403);
  const { orderId } = await ctx.params;
  if (!(await rateLimit(`pay:${await clientIp()}`, 20, 600))) return jsonError("Demasiados intentos de pago. Esperá unos minutos.", 429);
  const access = await orderFromRequest(req, orderId);
  if (!access) return jsonError("Pedido no encontrado.", 404);
  const idem = req.headers.get("x-idempotency-key") ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(idem)) return jsonError("Falta la clave de idempotencia.", 400);
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError("Datos de pago incompletos.", 400);
  const d = parsed.data;
  try {
    const out = await startCardPayment(orderId, {
      idempotencyKey: idem,
      token: d.token,
      paymentMethodId: d.payment_method_id,
      paymentTypeId: d.paymentTypeId,
      issuerId: d.issuer_id != null ? String(d.issuer_id) : null,
      installments: d.installments,
      transactionAmount: d.transaction_amount,
      payerEmail: d.payer?.email ?? access.order.email,
      identification: d.payer?.identification ?? null,
    });
    return jsonOk(out);
  } catch (e) {
    return flowErrorResponse(e);
  }
}
