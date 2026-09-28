import "server-only";
import { db } from "./db";
import { analyticsEvents } from "./db/schema";

type Name = "view_product" | "add_to_cart" | "begin_checkout" | "purchase";

/** Analítica propia sin datos personales. "purchase" solo se registra al aprobarse un pago (deduplicado por pedido). */
export async function recordEvent(name: Name, data: { productId?: string; orderId?: string; valueCents?: number; dedupeKey?: string } = {}) {
  try {
    await db
      .insert(analyticsEvents)
      .values({ name, productId: data.productId, orderId: data.orderId, valueCents: data.valueCents, dedupeKey: data.dedupeKey })
      .onConflictDoNothing();
  } catch {
    // La analítica nunca debe romper una compra.
  }
}
