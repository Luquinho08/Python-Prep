import "server-only";
import { authorizeOrderAccess } from "./orders/access";
import { PaymentFlowError } from "./payments/service";
import { jsonError } from "./http";

export async function orderFromRequest(req: Request, orderId: string) {
  const token = req.headers.get("x-order-token") ?? new URL(req.url).searchParams.get("t");
  return authorizeOrderAccess(orderId, token);
}

export function flowErrorResponse(e: unknown) {
  if (e instanceof PaymentFlowError) return jsonError(e.message, e.httpStatus, { code: e.code });
  console.error("[checkout] error inesperado", (e as Error)?.message);
  return jsonError("No pudimos procesar el pago. Si ves un cargo, no reintentes: verificamos el estado y te avisamos.", 500, { code: "unexpected" });
}
