import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import * as s from "@/lib/db/schema";
import { saveStoreSettings, storeSettingsSchema } from "@/lib/content/settings";
import { personalizationHash } from "@/lib/cart/service";
import type { CheckoutInput } from "@/lib/orders/checkout";

export async function resetDb() {
  const rows = await db.execute<{ tablename: string }>(sql`SELECT tablename FROM pg_tables WHERE schemaname = 'public'`);
  const names = rows.map((r) => `"${r.tablename}"`).join(", ");
  if (names) await db.execute(sql.raw(`TRUNCATE ${names} RESTART IDENTITY CASCADE`));
}

export async function seedBasics(opts: { stock?: number; price?: number; allowBackorder?: boolean } = {}) {
  await saveStoreSettings(storeSettingsSchema.parse({ contactEmail: "tienda@example.com", checkoutEnabled: true }), null);
  const [cat] = await db.insert(s.categories).values({ slug: "cajas", name: "Cajas" }).returning();
  const [cat2] = await db.insert(s.categories).values({ slug: "etiquetas", name: "Etiquetas" }).returning();
  const [theme] = await db.insert(s.themes).values({ slug: "dino", name: "Dino" }).returning();
  const [pickup] = await db.insert(s.shippingMethods).values({ name: "Retiro", kind: "pickup", priceCents: 0 }).returning();
  const [delivery] = await db.insert(s.shippingMethods).values({ name: "Envío CABA", kind: "delivery", postalCodes: ["1000-1499"], priceCents: 50000, deliveryDaysMin: 1, deliveryDaysMax: 3 }).returning();
  const product = await makeProduct({ slug: "caja", sku: "CAJ", price: opts.price ?? 100000, stock: opts.stock ?? 1, categoryId: cat.id, themeId: theme.id, allowBackorder: opts.allowBackorder });
  return { cat, cat2, theme, pickup, delivery, product };
}

export async function makeProduct(p: { slug: string; sku: string; price: number; stock: number; categoryId: string; themeId?: string; status?: "draft" | "published"; tags?: string[]; allowBackorder?: boolean; quote?: boolean; requiredField?: boolean }) {
  const [prod] = await db
    .insert(s.products)
    .values({ slug: p.slug, sku: p.sku, name: `Producto ${p.slug}`, basePriceCents: p.price, status: p.status ?? "published", tags: p.tags ?? [], allowBackorder: p.allowBackorder ?? false, isQuoteOnly: p.quote ?? false })
    .returning();
  const [variant] = await db.insert(s.productVariants).values({ productId: prod.id, sku: `${p.sku}-1`, name: "Única", stockOnHand: p.stock }).returning();
  await db.insert(s.productCategories).values({ productId: prod.id, categoryId: p.categoryId, isPrimary: true });
  if (p.themeId) await db.insert(s.productThemes).values({ productId: prod.id, themeId: p.themeId });
  if (p.requiredField) await db.insert(s.personalizationFields).values({ productId: prod.id, key: "nombre", label: "Nombre", type: "text", required: true, maxLength: 20 });
  return { ...prod, variant };
}

export async function makeCart(lines: { productId: string; variantId: string; quantity: number }[], couponCode: string | null = null) {
  const [cart] = await db.insert(s.carts).values({ tokenHash: randomUUID(), couponCode, expiresAt: new Date(Date.now() + 86400_000) }).returning();
  for (const l of lines) await db.insert(s.cartLines).values({ cartId: cart.id, ...l, personalization: [], personalizationHash: personalizationHash([]) });
  return cart;
}

export function checkoutInput(shippingMethodId: string, expectedTotalCents: number | null, over: Partial<CheckoutInput> = {}): CheckoutInput {
  return {
    checkoutKey: randomUUID(),
    name: "Ana Prueba",
    email: "ana@example.com",
    phone: "11 5555 5555",
    postalCode: "1425",
    shippingMethodId,
    acceptTerms: true,
    expectedTotalCents,
    ...over,
  };
}
