"use server";
import { getCartId } from "@/lib/cart/service";
import { getCurrentUser } from "@/lib/auth/session";
import { availableShippingMethods, checkoutSchema, createOrderFromCart, quoteCheckout, type CheckoutResult } from "@/lib/orders/checkout";
import { rateLimit } from "@/lib/rate-limit";
import { clientIp } from "@/lib/request";

export async function shippingOptionsAction(postalCode: string) {
  return availableShippingMethods(String(postalCode).slice(0, 10));
}

export async function quoteAction(input: { shippingMethodId: string | null; postalCode: string; email: string | null }) {
  const cartId = await getCartId();
  if (!cartId) return null;
  return quoteCheckout(cartId, input.shippingMethodId, String(input.postalCode ?? "").slice(0, 10), input.email);
}

export async function createOrderAction(raw: unknown): Promise<CheckoutResult> {
  if (!(await rateLimit(`checkout:${await clientIp()}`, 30, 600))) return { ok: false, kind: "error", message: "Demasiados intentos seguidos. Esperá unos minutos." };
  const parsed = checkoutSchema.safeParse(raw);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const i of parsed.error.issues) fieldErrors[String(i.path[0])] ??= i.message;
    return { ok: false, kind: "error", message: "Revisá los datos marcados.", fieldErrors };
  }
  const cartId = await getCartId();
  if (!cartId) return { ok: false, kind: "error", message: "Tu carrito venció. Volvé a agregar los productos." };
  const user = await getCurrentUser();
  return createOrderFromCart(parsed.data, { cartId, userId: user?.id ?? null });
}
