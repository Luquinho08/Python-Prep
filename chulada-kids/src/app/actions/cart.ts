"use server";
import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { addToCart, CartError, removeCartLine, setCartCoupon, updateCartLineQuantity } from "@/lib/cart/service";
import { getCurrentUser } from "@/lib/auth/session";
import { rateLimit } from "@/lib/rate-limit";
import { clientIp } from "@/lib/request";
import { recordEvent } from "@/lib/analytics";

export type CartActionState = { ok: boolean; message: string; fieldErrors?: Record<string, string>; ts?: number };

const idSchema = z.string().uuid();

export async function addToCartAction(_prev: CartActionState | null, formData: FormData): Promise<CartActionState> {
  const productId = idSchema.safeParse(formData.get("productId"));
  const variantId = idSchema.safeParse(formData.get("variantId"));
  if (!productId.success) return { ok: false, message: "Producto inválido." };
  if (!variantId.success) return { ok: false, message: "Elegí una opción.", fieldErrors: { variantId: "Elegí una opción." } };
  if (!(await rateLimit(`cart:${await clientIp()}`, 120, 60))) return { ok: false, message: "Demasiados intentos. Esperá un minuto." };

  const personalization: Record<string, string> = {};
  const uploadTokens: Record<string, string> = {};
  for (const [k, v] of formData.entries()) {
    if (typeof v !== "string") continue;
    if (k.startsWith("p_")) personalization[k.slice(2)] = v.slice(0, 1000);
    if (k.startsWith("t_")) uploadTokens[k.slice(2)] = v.slice(0, 200);
  }
  const user = await getCurrentUser();
  try {
    await addToCart({
      productId: productId.data,
      variantId: variantId.data,
      quantity: Number(formData.get("quantity") ?? 1),
      personalization,
      uploadTokens,
      userId: user?.id,
    });
  } catch (e) {
    if (e instanceof CartError) return { ok: false, message: e.message, fieldErrors: e.fieldErrors, ts: Date.now() };
    throw e;
  }
  await recordEvent("add_to_cart", { productId: productId.data });
  if (formData.get("intent") === "buy") redirect("/checkout");
  refresh();
  return { ok: true, message: "¡Listo! Agregamos el producto al carrito.", ts: Date.now() };
}

/** Agrega varios complementos sin configuración obligatoria (el servidor lo vuelve a verificar). */
export async function addManyToCartAction(_prev: CartActionState | null, formData: FormData): Promise<CartActionState> {
  const items = formData.getAll("item").map(String).slice(0, 8);
  if (items.length === 0) return { ok: false, message: "Elegí al menos un producto." };
  const user = await getCurrentUser();
  const added: string[] = [];
  const errors: string[] = [];
  for (const it of items) {
    const [productId, variantId] = it.split(":");
    if (!idSchema.safeParse(productId).success || !idSchema.safeParse(variantId).success) continue;
    const qty = Number(formData.get(`qty_${productId}`) ?? 1);
    try {
      await addToCart({ productId, variantId, quantity: qty, personalization: {}, userId: user?.id });
      added.push(productId);
    } catch (e) {
      if (e instanceof CartError) errors.push(e.message);
      else throw e;
    }
  }
  refresh();
  if (errors.length) return { ok: added.length > 0, message: `${added.length} agregado(s). ${errors.join(" ")}`, ts: Date.now() };
  return { ok: true, message: `Agregamos ${added.length} ${added.length === 1 ? "producto" : "productos"} al carrito.`, ts: Date.now() };
}

export async function updateQuantityAction(formData: FormData) {
  const lineId = idSchema.parse(formData.get("lineId"));
  const quantity = Number(formData.get("quantity"));
  try {
    await updateCartLineQuantity(lineId, quantity);
  } catch (e) {
    if (e instanceof CartError) redirect(`/carrito?error=${encodeURIComponent(e.message)}`);
    throw e;
  }
  refresh();
}

export async function removeLineAction(formData: FormData) {
  await removeCartLine(idSchema.parse(formData.get("lineId")));
  refresh();
}

export async function applyCouponAction(formData: FormData) {
  const code = String(formData.get("code") ?? "").trim();
  if (!(await rateLimit(`coupon:${await clientIp()}`, 20, 300))) redirect("/carrito?error=" + encodeURIComponent("Demasiados intentos con cupones. Probá en unos minutos."));
  await setCartCoupon(code || null);
  refresh();
}

export async function removeCouponAction() {
  await setCartCoupon(null);
  refresh();
}
