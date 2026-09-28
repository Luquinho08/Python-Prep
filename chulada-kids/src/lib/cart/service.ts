import "server-only";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { cookies } from "next/headers";
import { db } from "../db";
import { cartLines, carts, media, personalizationFields, products, productVariants, type PersonalizationValue } from "../db/schema";
import { randomToken, sha256, verifyResourceSignature } from "../crypto";
import { env } from "../env";
import { validatePersonalization } from "../catalog/personalization";
import { availableByVariant } from "../inventory/availability";
import { priceLines, quantityRuleText } from "./pricing";

export const CART_COOKIE = "ck_cart";
const CART_DAYS = 30;

export class CartError extends Error {
  constructor(
    message: string,
    public fieldErrors?: Record<string, string>,
  ) {
    super(message);
  }
}

async function cartFromCookie() {
  const jar = await cookies();
  const token = jar.get(CART_COOKIE)?.value;
  if (!token) return null;
  const [cart] = await db.select().from(carts).where(eq(carts.tokenHash, sha256(token)));
  if (!cart || cart.expiresAt < new Date()) return null;
  return cart;
}

export async function getCartId(): Promise<string | null> {
  return (await cartFromCookie())?.id ?? null;
}

/** Solo en server actions / route handlers (escribe cookie). */
export async function getOrCreateCart(userId?: string | null) {
  const existing = await cartFromCookie();
  if (existing) return existing;
  const token = randomToken(32);
  const expiresAt = new Date(Date.now() + CART_DAYS * 86400_000);
  const [cart] = await db.insert(carts).values({ tokenHash: sha256(token), userId: userId ?? null, expiresAt }).returning();
  const jar = await cookies();
  jar.set(CART_COOKIE, token, { httpOnly: true, secure: env.isProduction, sameSite: "lax", path: "/", expires: expiresAt });
  return cart;
}

export function personalizationHash(values: PersonalizationValue[]): string {
  const normalized = [...values].sort((a, b) => a.key.localeCompare(b.key)).map((v) => [v.key, v.value]);
  return sha256(JSON.stringify(normalized));
}

/** Firma que prueba que un archivo privado fue subido en este carrito. */
export function uploadClaim(mediaId: string, cartId: string) {
  return `upload:${mediaId}:${cartId}`;
}

export async function addToCart(input: {
  productId: string;
  variantId: string;
  quantity: number;
  personalization: Record<string, string>;
  uploadTokens?: Record<string, string>;
  userId?: string | null;
}) {
  const [p] = await db.select().from(products).where(eq(products.id, input.productId));
  if (!p || p.status !== "published") throw new CartError("Este producto no está disponible.");
  if (p.isQuoteOnly) throw new CartError("Este producto se cotiza a pedido. Usá el formulario de consulta.");
  const [v] = await db
    .select()
    .from(productVariants)
    .where(and(eq(productVariants.id, input.variantId), eq(productVariants.productId, p.id), eq(productVariants.isActive, true)));
  if (!v) throw new CartError("Elegí una opción válida.", { variantId: "Elegí una opción válida." });

  const q = Math.trunc(input.quantity);
  if (!Number.isFinite(q) || q < p.minQty || (q - p.minQty) % p.qtyStep !== 0 || (p.maxQty != null && q > p.maxQty)) {
    throw new CartError(quantityRuleText(p.minQty, p.qtyStep, p.maxQty), { quantity: quantityRuleText(p.minQty, p.qtyStep, p.maxQty) });
  }

  const cart = await getOrCreateCart(input.userId);
  const fields = await db.select().from(personalizationFields).where(eq(personalizationFields.productId, p.id));

  // Archivos: solo se aceptan los subidos en este carrito (firma) y privados.
  const fileNames: Record<string, string> = {};
  for (const f of fields.filter((x) => x.type === "file")) {
    const mediaId = input.personalization[f.key];
    if (!mediaId) continue;
    const token = input.uploadTokens?.[f.key] ?? null;
    if (!verifyResourceSignature(uploadClaim(mediaId, cart.id), token)) {
      throw new CartError("El archivo de referencia venció o no es válido. Volvé a subirlo.", { [f.key]: "Volvé a subir el archivo." });
    }
    const [m] = await db.select().from(media).where(and(eq(media.id, mediaId), eq(media.visibility, "private")));
    if (!m) throw new CartError("No encontramos el archivo subido.", { [f.key]: "Volvé a subir el archivo." });
    fileNames[mediaId.toLowerCase()] = m.originalName ?? "Archivo de referencia";
  }

  const result = validatePersonalization(fields, input.personalization, { fileDisplayNames: fileNames });
  if (!result.ok) throw new CartError("Revisá los datos de personalización.", result.errors);

  const hash = personalizationHash(result.values);
  const existingLines = await db.select().from(cartLines).where(and(eq(cartLines.cartId, cart.id), eq(cartLines.variantId, v.id)));
  const sameLine = existingLines.find((l) => l.personalizationHash === hash);
  const alreadyForVariant = existingLines.reduce((s, l) => s + l.quantity, 0);
  const available = (await availableByVariant([v.id])).get(v.id) ?? 0;
  if (!p.allowBackorder && alreadyForVariant + q > available) {
    const left = Math.max(0, available - alreadyForVariant);
    throw new CartError(
      left > 0 ? `Solo podés agregar ${left} más (disponibles: ${available}).` : alreadyForVariant > 0 ? "Ya tenés en el carrito todas las unidades disponibles." : "Sin disponibilidad en este momento.",
      { quantity: "Cantidad no disponible." },
    );
  }

  if (sameLine) {
    const newQty = sameLine.quantity + q;
    if (p.maxQty != null && newQty > p.maxQty) throw new CartError(`El máximo por pedido es ${p.maxQty}.`);
    await db.update(cartLines).set({ quantity: newQty, updatedAt: new Date() }).where(eq(cartLines.id, sameLine.id));
  } else {
    await db.insert(cartLines).values({
      cartId: cart.id,
      productId: p.id,
      variantId: v.id,
      quantity: q,
      personalization: result.values,
      personalizationHash: hash,
    });
  }
  await db.update(carts).set({ updatedAt: new Date() }).where(eq(carts.id, cart.id));
  return { cartId: cart.id };
}

export async function updateCartLineQuantity(lineId: string, quantity: number) {
  const cart = await cartFromCookie();
  if (!cart) throw new CartError("Tu carrito venció.");
  const [line] = await db.select().from(cartLines).where(and(eq(cartLines.id, lineId), eq(cartLines.cartId, cart.id)));
  if (!line) throw new CartError("La línea ya no existe.");
  if (quantity <= 0) {
    await db.delete(cartLines).where(eq(cartLines.id, line.id));
    return;
  }
  const [p] = await db.select().from(products).where(eq(products.id, line.productId));
  const q = Math.trunc(quantity);
  if (!p || q < p.minQty || (q - p.minQty) % p.qtyStep !== 0 || (p.maxQty != null && q > p.maxQty)) {
    throw new CartError(p ? quantityRuleText(p.minQty, p.qtyStep, p.maxQty) : "Producto no disponible.");
  }
  if (!p.allowBackorder && q > line.quantity) {
    const others = await db.select().from(cartLines).where(and(eq(cartLines.cartId, cart.id), eq(cartLines.variantId, line.variantId)));
    const otherQty = others.filter((o) => o.id !== line.id).reduce((s, o) => s + o.quantity, 0);
    const available = (await availableByVariant([line.variantId])).get(line.variantId) ?? 0;
    if (otherQty + q > available) throw new CartError(`Solo hay ${Math.max(0, available - otherQty)} disponibles para esta opción.`);
  }
  await db.update(cartLines).set({ quantity: q, updatedAt: new Date() }).where(eq(cartLines.id, line.id));
}

export async function removeCartLine(lineId: string) {
  const cart = await cartFromCookie();
  if (!cart) return;
  await db.delete(cartLines).where(and(eq(cartLines.id, lineId), eq(cartLines.cartId, cart.id)));
}

export async function setCartCoupon(code: string | null) {
  const cart = await getOrCreateCart();
  await db
    .update(carts)
    .set({ couponCode: code ? code.trim().toUpperCase().slice(0, 40) : null, updatedAt: new Date() })
    .where(eq(carts.id, cart.id));
}

export async function clearCart(cartId: string) {
  await db.delete(cartLines).where(eq(cartLines.cartId, cartId));
  await db.update(carts).set({ couponCode: null, updatedAt: new Date() }).where(eq(carts.id, cartId));
}

export async function loadRawLines(cartId: string) {
  return db.select().from(cartLines).where(eq(cartLines.cartId, cartId)).orderBy(asc(cartLines.createdAt));
}

/** Vista completa del carrito actual (lectura; no crea cookie). */
export async function getCartView(customerKey?: string | null) {
  const cart = await cartFromCookie();
  if (!cart) return { cart: null, lines: [], totals: null, hasIssues: false, count: 0 };
  const raw = await loadRawLines(cart.id);
  if (raw.length === 0) return { cart, lines: [], totals: null, hasIssues: false, count: 0 };
  const priced = await priceLines({ lines: raw, couponCode: cart.couponCode, customerKey });
  return { cart, ...priced, count: raw.reduce((s, l) => s + l.quantity, 0) };
}

export async function getCartCount(): Promise<number> {
  const cart = await cartFromCookie();
  if (!cart) return 0;
  const raw = await db.select({ q: cartLines.quantity }).from(cartLines).where(eq(cartLines.cartId, cart.id));
  return raw.reduce((s, l) => s + l.q, 0);
}

/** Al iniciar sesión: asocia el carrito actual y recupera líneas de un carrito anterior del usuario. */
export async function attachCartToUser(userId: string) {
  const current = await cartFromCookie();
  const [previous] = await db
    .select()
    .from(carts)
    .where(eq(carts.userId, userId))
    .orderBy(desc(carts.updatedAt))
    .limit(1);
  if (!current) return;
  await db.update(carts).set({ userId }).where(eq(carts.id, current.id));
  if (previous && previous.id !== current.id) {
    const currentLines = await loadRawLines(current.id);
    if (currentLines.length === 0) {
      const prevLines = await loadRawLines(previous.id);
      if (prevLines.length) {
        await db.update(cartLines).set({ cartId: current.id }).where(inArray(cartLines.id, prevLines.map((l) => l.id)));
      }
    }
  }
}
