import { after } from "next/server";
import { processWebhookEvent, recordWebhook, verifyWebhookSignature } from "@/lib/payments/webhooks";

/**
 * Notificaciones de Mercado Pago (tópicos "order" y "payment").
 * 1) Valida la firma. 2) Guarda el evento de forma duradera. 3) Responde 200.
 * 4) Procesa consultando el recurso oficial (con reintentos por cron si falla).
 */
export async function POST(req: Request) {
  const url = new URL(req.url);
  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    body = {};
  }
  const bodyData = (body.data ?? {}) as { id?: unknown };
  const dataId = url.searchParams.get("data.id") ?? url.searchParams.get("id") ?? (bodyData.id != null ? String(bodyData.id) : null);
  const type = url.searchParams.get("type") ?? url.searchParams.get("topic") ?? (typeof body.type === "string" ? body.type : null);
  const incoming = { dataId, type, xSignature: req.headers.get("x-signature"), xRequestId: req.headers.get("x-request-id"), payload: body };

  const sig = verifyWebhookSignature(incoming);
  let recorded;
  try {
    recorded = await recordWebhook(incoming, sig.ok);
  } catch {
    // Si no se pudo guardar, NO se reconoce: el proveedor reintentará.
    return new Response("Error guardando la notificación", { status: 500 });
  }
  if (!sig.ok) return new Response("Firma inválida", { status: 401 });
  if (!recorded.duplicate) {
    after(async () => {
      await processWebhookEvent(recorded.id);
    });
  }
  return new Response(null, { status: 200 });
}
