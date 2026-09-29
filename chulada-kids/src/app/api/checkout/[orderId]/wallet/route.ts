import { jsonError, jsonOk, sameOrigin } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";
import { clientIp } from "@/lib/request";
import { startWalletPayment } from "@/lib/payments/service";
import { flowErrorResponse, orderFromRequest } from "@/lib/checkout-http";

export async function POST(req: Request, ctx: RouteContext<"/api/checkout/[orderId]/wallet">) {
  if (!sameOrigin(req)) return jsonError("Origen no permitido.", 403);
  const { orderId } = await ctx.params;
  if (!(await rateLimit(`wallet:${await clientIp()}`, 20, 600))) return jsonError("Demasiados intentos. Esperá unos minutos.", 429);
  const access = await orderFromRequest(req, orderId);
  if (!access) return jsonError("Pedido no encontrado.", 404);
  const idem = req.headers.get("x-idempotency-key") ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(idem)) return jsonError("Falta la clave de idempotencia.", 400);
  try {
    return jsonOk(await startWalletPayment(orderId, idem));
  } catch (e) {
    return flowErrorResponse(e);
  }
}
