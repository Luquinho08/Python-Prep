import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
const createdAt = () => ts("created_at").notNull().defaultNow();
const updatedAt = () => ts("updated_at").notNull().defaultNow();
const money = (name: string) => bigint(name, { mode: "number" });

// ───────────────────────── Usuarios, sesiones, roles ─────────────────────────

export const userRole = pgEnum("user_role", ["customer", "owner", "catalog_editor", "order_operator"]);

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull(),
    name: text("name").notNull().default(""),
    phone: text("phone"),
    passwordHash: text("password_hash"),
    role: userRole("role").notNull().default("customer"),
    emailVerifiedAt: ts("email_verified_at"),
    disabledAt: ts("disabled_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("users_email_uq").on(t.email)],
);

export const sessions = pgTable(
  "sessions",
  {
    id: text("id").primaryKey(), // sha256(token)
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    expiresAt: ts("expires_at").notNull(),
    createdAt: createdAt(),
    lastSeenAt: createdAt(),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

export const authTokens = pgTable(
  "auth_tokens",
  {
    id: text("id").primaryKey(), // sha256(token)
    kind: text("kind", { enum: ["password_reset", "invitation", "order_access"] }).notNull(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
    email: text("email"),
    role: userRole("role"),
    expiresAt: ts("expires_at").notNull(),
    usedAt: ts("used_at"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [index("auth_tokens_email_idx").on(t.email)],
);

export const addresses = pgTable("addresses", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  label: text("label").notNull().default("Principal"),
  recipient: text("recipient").notNull(),
  street: text("street").notNull(),
  number: text("number").notNull(),
  apartment: text("apartment"),
  city: text("city").notNull(),
  province: text("province").notNull(),
  postalCode: text("postal_code").notNull(),
  notes: text("notes"),
  createdAt: createdAt(),
});

export const rateLimits = pgTable(
  "rate_limits",
  {
    key: text("key").notNull(),
    windowStart: ts("window_start").notNull(),
    count: integer("count").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.key, t.windowStart] })],
);

// ───────────────────────── Medios ─────────────────────────

export const media = pgTable("media", {
  id: uuid("id").primaryKey().defaultRandom(),
  visibility: text("visibility", { enum: ["public", "private"] }).notNull(),
  storageKey: text("storage_key").notNull().unique(),
  mime: text("mime").notNull(),
  bytes: integer("bytes").notNull(),
  width: integer("width"),
  height: integer("height"),
  alt: text("alt").notNull().default(""),
  originalName: text("original_name"),
  isPlaceholder: boolean("is_placeholder").notNull().default(false),
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: createdAt(),
});

// ───────────────────────── Catálogo ─────────────────────────

export const categories = pgTable("categories", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  imageId: uuid("image_id").references(() => media.id, { onDelete: "set null" }),
  sort: integer("sort").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/** Temáticas / colecciones / ocasiones (p. ej. "Dinos", "Primer añito"). */
export const themes = pgTable("themes", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  imageId: uuid("image_id").references(() => media.id, { onDelete: "set null" }),
  sort: integer("sort").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const productStatus = pgEnum("product_status", ["draft", "published", "archived"]);
export const inventoryMode = pgEnum("inventory_mode", ["stock", "capacity"]);

export const products = pgTable(
  "products",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull(),
    sku: text("sku").notNull(),
    name: text("name").notNull(),
    shortDescription: text("short_description").notNull().default(""),
    longDescriptionHtml: text("long_description_html").notNull().default(""),
    status: productStatus("status").notNull().default("draft"),
    basePriceCents: money("base_price_cents").notNull(),
    /** Cantidad de unidades que incluye un pack (1 = unidad suelta). */
    packUnits: integer("pack_units").notNull().default(1),
    unitLabel: text("unit_label").notNull().default("unidad"),
    minQty: integer("min_qty").notNull().default(1),
    qtyStep: integer("qty_step").notNull().default(1),
    maxQty: integer("max_qty"),
    inventoryMode: inventoryMode("inventory_mode").notNull().default("stock"),
    allowBackorder: boolean("allow_backorder").notNull().default(false),
    productionDaysMin: integer("production_days_min").notNull().default(0),
    productionDaysMax: integer("production_days_max").notNull().default(0),
    packContents: text("pack_contents").notNull().default(""),
    materials: text("materials").notNull().default(""),
    dimensions: text("dimensions").notNull().default(""),
    deliveryNotes: text("delivery_notes").notNull().default(""),
    weightGrams: integer("weight_grams"),
    isQuoteOnly: boolean("is_quote_only").notNull().default(false),
    requiresDesignApproval: boolean("requires_design_approval").notNull().default(false),
    isFeatured: boolean("is_featured").notNull().default(false),
    featuredSort: integer("featured_sort").notNull().default(0),
    tags: text("tags").array().notNull().default(sql`'{}'::text[]`),
    seoTitle: text("seo_title"),
    seoDescription: text("seo_description"),
    isDemo: boolean("is_demo").notNull().default(false),
    publishedAt: ts("published_at"),
    archivedAt: ts("archived_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("products_slug_uq").on(t.slug),
    uniqueIndex("products_sku_uq").on(t.sku),
    index("products_status_idx").on(t.status),
    index("products_featured_idx").on(t.isFeatured, t.featuredSort),
    check("products_price_nonneg", sql`${t.basePriceCents} >= 0`),
    check("products_pack_units_pos", sql`${t.packUnits} >= 1`),
    check("products_min_qty_pos", sql`${t.minQty} >= 1 AND ${t.qtyStep} >= 1`),
  ],
);

export const productCategories = pgTable(
  "product_categories",
  {
    productId: uuid("product_id").notNull().references(() => products.id, { onDelete: "cascade" }),
    categoryId: uuid("category_id").notNull().references(() => categories.id, { onDelete: "cascade" }),
    isPrimary: boolean("is_primary").notNull().default(false),
  },
  (t) => [primaryKey({ columns: [t.productId, t.categoryId] }), index("pc_category_idx").on(t.categoryId)],
);

export const productThemes = pgTable(
  "product_themes",
  {
    productId: uuid("product_id").notNull().references(() => products.id, { onDelete: "cascade" }),
    themeId: uuid("theme_id").notNull().references(() => themes.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.productId, t.themeId] }), index("pt_theme_idx").on(t.themeId)],
);

export const productImages = pgTable(
  "product_images",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    productId: uuid("product_id").notNull().references(() => products.id, { onDelete: "cascade" }),
    mediaId: uuid("media_id").notNull().references(() => media.id, { onDelete: "restrict" }),
    alt: text("alt").notNull().default(""),
    sort: integer("sort").notNull().default(0),
  },
  (t) => [index("product_images_product_idx").on(t.productId, t.sort)],
);

export const productVariants = pgTable(
  "product_variants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    productId: uuid("product_id").notNull().references(() => products.id, { onDelete: "cascade" }),
    sku: text("sku").notNull(),
    name: text("name").notNull(),
    /** null = usa el precio base del producto */
    priceCents: money("price_cents"),
    /** Existencia (stock) o cupos de producción (capacity). */
    stockOnHand: integer("stock_on_hand").notNull().default(0),
    lowStockThreshold: integer("low_stock_threshold").notNull().default(3),
    isActive: boolean("is_active").notNull().default(true),
    sort: integer("sort").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("variants_sku_uq").on(t.sku),
    index("variants_product_idx").on(t.productId),
    check("variants_stock_nonneg", sql`${t.stockOnHand} >= 0`),
    check("variants_price_nonneg", sql`${t.priceCents} IS NULL OR ${t.priceCents} >= 0`),
  ],
);

export type PersonalizationOption = { value: string; label: string; surchargeCents?: number };

export const personalizationFields = pgTable(
  "personalization_fields",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    productId: uuid("product_id").notNull().references(() => products.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    label: text("label").notNull(),
    type: text("type", { enum: ["text", "textarea", "select", "date", "file"] }).notNull(),
    required: boolean("required").notNull().default(false),
    maxLength: integer("max_length"),
    options: jsonb("options").$type<PersonalizationOption[]>().notNull().default([]),
    /** Recargo por pack cuando el campo se completa (texto/archivo). */
    surchargeCents: money("surcharge_cents").notNull().default(0),
    helpText: text("help_text").notNull().default(""),
    /** Para fechas: días mínimos de anticipación respecto de hoy (elaboración + entrega). */
    minLeadDays: integer("min_lead_days"),
    acceptMime: text("accept_mime").array(),
    maxFileMb: integer("max_file_mb"),
    sort: integer("sort").notNull().default(0),
  },
  (t) => [uniqueIndex("pf_product_key_uq").on(t.productId, t.key)],
);

/** Relaciones manuales de complementarios (direccionales). */
export const productRelations = pgTable(
  "product_relations",
  {
    productId: uuid("product_id").notNull().references(() => products.id, { onDelete: "cascade" }),
    relatedProductId: uuid("related_product_id").notNull().references(() => products.id, { onDelete: "cascade" }),
    sort: integer("sort").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.productId, t.relatedProductId] }),
    check("pr_not_self", sql`${t.productId} <> ${t.relatedProductId}`),
  ],
);

/** Matriz de categorías complementarias (p. ej. cajas → etiquetas). */
export const categoryComplements = pgTable(
  "category_complements",
  {
    categoryId: uuid("category_id").notNull().references(() => categories.id, { onDelete: "cascade" }),
    complementCategoryId: uuid("complement_category_id").notNull().references(() => categories.id, { onDelete: "cascade" }),
    sort: integer("sort").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.categoryId, t.complementCategoryId] })],
);

// ───────────────────────── Promociones y cupones ─────────────────────────

export const discountKind = pgEnum("discount_kind", ["percent", "fixed"]);

export const promotions = pgTable("promotions", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  kind: discountKind("kind").notNull(),
  /** percent: basis points (1000 = 10%). fixed: centavos por unidad/pack. */
  value: integer("value").notNull(),
  scope: text("scope", { enum: ["products", "categories", "all"] }).notNull(),
  startsAt: ts("starts_at").notNull(),
  endsAt: ts("ends_at"),
  isActive: boolean("is_active").notNull().default(true),
  stackable: boolean("stackable").notNull().default(false),
  priority: integer("priority").notNull().default(0),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const promotionProducts = pgTable(
  "promotion_products",
  {
    promotionId: uuid("promotion_id").notNull().references(() => promotions.id, { onDelete: "cascade" }),
    productId: uuid("product_id").notNull().references(() => products.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.promotionId, t.productId] })],
);

export const promotionCategories = pgTable(
  "promotion_categories",
  {
    promotionId: uuid("promotion_id").notNull().references(() => promotions.id, { onDelete: "cascade" }),
    categoryId: uuid("category_id").notNull().references(() => categories.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.promotionId, t.categoryId] })],
);

export const coupons = pgTable("coupons", {
  id: uuid("id").primaryKey().defaultRandom(),
  code: text("code").notNull().unique(),
  description: text("description").notNull().default(""),
  kind: discountKind("kind").notNull(),
  value: integer("value").notNull(),
  minSubtotalCents: money("min_subtotal_cents").notNull().default(0),
  startsAt: ts("starts_at"),
  endsAt: ts("ends_at"),
  maxUses: integer("max_uses"),
  maxUsesPerCustomer: integer("max_uses_per_customer"),
  combinableWithPromotions: boolean("combinable_with_promotions").notNull().default(false),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const couponRedemptions = pgTable(
  "coupon_redemptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    couponId: uuid("coupon_id").notNull().references(() => coupons.id, { onDelete: "restrict" }),
    orderId: uuid("order_id").notNull(),
    customerKey: text("customer_key").notNull(),
    status: text("status", { enum: ["reserved", "used", "released"] }).notNull(),
    reservedUntil: ts("reserved_until"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("coupon_redemptions_order_uq").on(t.orderId), index("cr_coupon_idx").on(t.couponId, t.status)],
);

// ───────────────────────── Carrito ─────────────────────────

export const carts = pgTable("carts", {
  id: uuid("id").primaryKey().defaultRandom(),
  tokenHash: text("token_hash").notNull().unique(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
  couponCode: text("coupon_code"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  expiresAt: ts("expires_at").notNull(),
});

export type PersonalizationValue = { key: string; label: string; value: string; display: string; mediaId?: string };

export const cartLines = pgTable(
  "cart_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    cartId: uuid("cart_id").notNull().references(() => carts.id, { onDelete: "cascade" }),
    productId: uuid("product_id").notNull().references(() => products.id, { onDelete: "cascade" }),
    variantId: uuid("variant_id").notNull().references(() => productVariants.id, { onDelete: "cascade" }),
    quantity: integer("quantity").notNull(),
    personalization: jsonb("personalization").$type<PersonalizationValue[]>().notNull().default([]),
    personalizationHash: text("personalization_hash").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("cart_lines_merge_uq").on(t.cartId, t.variantId, t.personalizationHash),
    check("cart_lines_qty_pos", sql`${t.quantity} > 0`),
  ],
);

// ───────────────────────── Entregas ─────────────────────────

export const shippingMethods = pgTable("shipping_methods", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  kind: text("kind", { enum: ["pickup", "delivery"] }).notNull(),
  description: text("description").notNull().default(""),
  /** Códigos postales exactos o rangos "1000-1499". Vacío en pickup. */
  postalCodes: text("postal_codes").array().notNull().default(sql`'{}'::text[]`),
  priceCents: money("price_cents").notNull().default(0),
  deliveryDaysMin: integer("delivery_days_min").notNull().default(0),
  deliveryDaysMax: integer("delivery_days_max").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
  sort: integer("sort").notNull().default(0),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

// ───────────────────────── Pedidos ─────────────────────────

export const paymentStatus = pgEnum("payment_status", [
  "unpaid",
  "pending",
  "requires_action",
  "approved",
  "rejected",
  "cancelled",
  "expired",
  "refunded",
  "partially_refunded",
  "charged_back",
  "to_verify",
]);

export const fulfillmentStatus = pgEnum("fulfillment_status", [
  "awaiting_payment",
  "received",
  "awaiting_data",
  "awaiting_approval",
  "in_production",
  "ready",
  "shipped",
  "picked_up",
  "delivered",
  "cancelled",
]);

export type OrderAddress = {
  street: string;
  number: string;
  apartment?: string;
  city: string;
  province: string;
  postalCode: string;
  notes?: string;
};

export type ShippingSnapshot = {
  methodId: string;
  name: string;
  kind: "pickup" | "delivery";
  priceCents: number;
  deliveryDaysMin: number;
  deliveryDaysMax: number;
  description: string;
};

export const orders = pgTable(
  "orders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    number: serial("number").notNull().unique(),
    checkoutKey: text("checkout_key").notNull().unique(),
    accessTokenHash: text("access_token_hash").notNull().unique(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    cartId: uuid("cart_id"),
    email: text("email").notNull(),
    customerName: text("customer_name").notNull(),
    phone: text("phone").notNull(),
    shipping: jsonb("shipping").$type<ShippingSnapshot>().notNull(),
    address: jsonb("address").$type<OrderAddress | null>(),
    subtotalCents: money("subtotal_cents").notNull(),
    promotionDiscountCents: money("promotion_discount_cents").notNull().default(0),
    couponDiscountCents: money("coupon_discount_cents").notNull().default(0),
    shippingCents: money("shipping_cents").notNull(),
    totalCents: money("total_cents").notNull(),
    currency: text("currency").notNull().default("ARS"),
    couponCode: text("coupon_code"),
    pricingSnapshot: jsonb("pricing_snapshot").notNull(),
    paymentStatus: paymentStatus("payment_status").notNull().default("unpaid"),
    fulfillmentStatus: fulfillmentStatus("fulfillment_status").notNull().default("awaiting_payment"),
    termsVersion: text("terms_version").notNull(),
    termsAcceptedAt: ts("terms_accepted_at").notNull(),
    customerNotes: text("customer_notes"),
    reservationExpiresAt: ts("reservation_expires_at"),
    productionDaysMax: integer("production_days_max").notNull().default(0),
    eventDate: date("event_date"),
    paidAt: ts("paid_at"),
    cancelledAt: ts("cancelled_at"),
    supersededBy: uuid("superseded_by"),
    confirmationSentAt: ts("confirmation_sent_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("orders_created_idx").on(t.createdAt),
    index("orders_email_idx").on(t.email),
    index("orders_payment_idx").on(t.paymentStatus),
    index("orders_fulfillment_idx").on(t.fulfillmentStatus),
    check("orders_total_nonneg", sql`${t.totalCents} >= 0`),
  ],
);

export const orderLines = pgTable(
  "order_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderId: uuid("order_id").notNull().references(() => orders.id, { onDelete: "cascade" }),
    productId: uuid("product_id").references(() => products.id, { onDelete: "set null" }),
    variantId: uuid("variant_id").references(() => productVariants.id, { onDelete: "set null" }),
    productName: text("product_name").notNull(),
    variantName: text("variant_name").notNull(),
    sku: text("sku").notNull(),
    quantity: integer("quantity").notNull(),
    packUnits: integer("pack_units").notNull(),
    unitLabel: text("unit_label").notNull(),
    regularUnitPriceCents: money("regular_unit_price_cents").notNull(),
    unitPriceCents: money("unit_price_cents").notNull(),
    surchargeUnitCents: money("surcharge_unit_cents").notNull().default(0),
    promotionDiscountCents: money("promotion_discount_cents").notNull().default(0),
    couponDiscountCents: money("coupon_discount_cents").notNull().default(0),
    lineTotalCents: money("line_total_cents").notNull(),
    personalization: jsonb("personalization").$type<PersonalizationValue[]>().notNull().default([]),
    appliedPromotions: jsonb("applied_promotions").$type<{ id: string; name: string; savingCents: number }[]>().notNull().default([]),
    requiresDesignApproval: boolean("requires_design_approval").notNull().default(false),
    inventoryMode: inventoryMode("inventory_mode").notNull(),
    productionDaysMax: integer("production_days_max").notNull().default(0),
  },
  (t) => [index("order_lines_order_idx").on(t.orderId), index("order_lines_product_idx").on(t.productId)],
);

export const orderEvents = pgTable(
  "order_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderId: uuid("order_id").notNull().references(() => orders.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    fromValue: text("from_value"),
    toValue: text("to_value"),
    message: text("message"),
    actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
    actorLabel: text("actor_label").notNull().default("sistema"),
    createdAt: createdAt(),
  },
  (t) => [index("order_events_order_idx").on(t.orderId, t.createdAt)],
);

export const orderNotes = pgTable("order_notes", {
  id: uuid("id").primaryKey().defaultRandom(),
  orderId: uuid("order_id").notNull().references(() => orders.id, { onDelete: "cascade" }),
  /** internal = solo equipo; customer = visible para el comprador. */
  visibility: text("visibility", { enum: ["internal", "customer"] }).notNull(),
  body: text("body").notNull(),
  authorUserId: uuid("author_user_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: createdAt(),
});

export const designProofs = pgTable(
  "design_proofs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderId: uuid("order_id").notNull().references(() => orders.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    mediaId: uuid("media_id").references(() => media.id, { onDelete: "set null" }),
    note: text("note").notNull().default(""),
    status: text("status", { enum: ["pending", "approved", "changes_requested"] }).notNull().default("pending"),
    customerComment: text("customer_comment"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    decidedAt: ts("decided_at"),
  },
  (t) => [uniqueIndex("design_proofs_version_uq").on(t.orderId, t.version)],
);

export const stockReservations = pgTable(
  "stock_reservations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderId: uuid("order_id").notNull().references(() => orders.id, { onDelete: "cascade" }),
    variantId: uuid("variant_id").notNull().references(() => productVariants.id, { onDelete: "restrict" }),
    quantity: integer("quantity").notNull(),
    status: text("status", { enum: ["active", "consumed", "released"] }).notNull().default("active"),
    expiresAt: ts("expires_at").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("reservations_variant_active_idx").on(t.variantId, t.status, t.expiresAt),
    index("reservations_order_idx").on(t.orderId),
    check("reservations_qty_pos", sql`${t.quantity} > 0`),
  ],
);

export const incidents = pgTable("incidents", {
  id: uuid("id").primaryKey().defaultRandom(),
  orderId: uuid("order_id").references(() => orders.id, { onDelete: "set null" }),
  kind: text("kind", {
    enum: ["duplicate_payment", "late_approval_no_stock", "amount_mismatch", "unknown_payment", "refund_failed", "other"],
  }).notNull(),
  details: jsonb("details").notNull().default({}),
  status: text("status", { enum: ["open", "resolved"] }).notNull().default("open"),
  resolvedBy: uuid("resolved_by").references(() => users.id, { onDelete: "set null" }),
  resolvedAt: ts("resolved_at"),
  createdAt: createdAt(),
});

// ───────────────────────── Pagos ─────────────────────────

export const paymentAttempts = pgTable(
  "payment_attempts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderId: uuid("order_id").notNull().references(() => orders.id, { onDelete: "cascade" }),
    method: text("method", { enum: ["card", "wallet"] }).notNull(),
    provider: text("provider").notNull().default("mercadopago"),
    driver: text("driver", { enum: ["mercadopago", "fake"] }).notNull(),
    environment: text("environment", { enum: ["test", "production"] }).notNull(),
    idempotencyKey: text("idempotency_key").notNull().unique(),
    amountCents: money("amount_cents").notNull(),
    currency: text("currency").notNull().default("ARS"),
    /** Orders API: id de la order; Wallet: id de la preferencia. */
    providerRef: text("provider_ref"),
    status: paymentStatus("status").notNull().default("pending"),
    statusDetail: text("status_detail"),
    installments: integer("installments"),
    paymentMethodId: text("payment_method_id"),
    challengeUrl: text("challenge_url"),
    lastCheckedAt: ts("last_checked_at"),
    errorCode: text("error_code"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("attempts_order_idx").on(t.orderId), index("attempts_status_idx").on(t.status)],
);

export const payments = pgTable(
  "payments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderId: uuid("order_id").notNull().references(() => orders.id, { onDelete: "cascade" }),
    attemptId: uuid("attempt_id").references(() => paymentAttempts.id, { onDelete: "set null" }),
    providerPaymentId: text("provider_payment_id").notNull(),
    status: paymentStatus("status").notNull(),
    statusDetail: text("status_detail"),
    amountCents: money("amount_cents").notNull(),
    refundedCents: money("refunded_cents").notNull().default(0),
    currency: text("currency").notNull(),
    collectorId: text("collector_id"),
    appliedToOrder: boolean("applied_to_order").notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("payments_provider_id_uq").on(t.providerPaymentId), index("payments_order_idx").on(t.orderId)],
);

export const webhookEvents = pgTable(
  "webhook_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    provider: text("provider").notNull(),
    topic: text("topic").notNull(),
    resourceId: text("resource_id").notNull(),
    requestId: text("request_id"),
    dedupeKey: text("dedupe_key").notNull().unique(),
    signatureValid: boolean("signature_valid").notNull(),
    payload: jsonb("payload").notNull(),
    status: text("status", { enum: ["received", "processed", "failed", "ignored", "rejected"] }).notNull().default("received"),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    nextAttemptAt: ts("next_attempt_at"),
    receivedAt: createdAt(),
    processedAt: ts("processed_at"),
  },
  (t) => [index("webhook_events_status_idx").on(t.status, t.nextAttemptAt)],
);

export const paymentConnections = pgTable("payment_connections", {
  id: uuid("id").primaryKey().defaultRandom(),
  provider: text("provider").notNull().default("mercadopago"),
  mode: text("mode", { enum: ["oauth", "manual"] }).notNull(),
  environment: text("environment", { enum: ["test", "production"] }).notNull(),
  accountId: text("account_id"),
  accountLabel: text("account_label"),
  siteId: text("site_id"),
  publicKey: text("public_key"),
  accessTokenEnc: text("access_token_enc"),
  refreshTokenEnc: text("refresh_token_enc"),
  tokenExpiresAt: ts("token_expires_at"),
  status: text("status", { enum: ["connected", "disconnected", "revoked", "error"] }).notNull(),
  lastError: text("last_error"),
  connectedBy: uuid("connected_by").references(() => users.id, { onDelete: "set null" }),
  connectedAt: ts("connected_at"),
  disconnectedAt: ts("disconnected_at"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const oauthStates = pgTable("oauth_states", {
  id: text("id").primaryKey(), // sha256(state)
  sessionId: text("session_id").notNull(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  environment: text("environment", { enum: ["test", "production"] }).notNull(),
  codeVerifierEnc: text("code_verifier_enc"),
  expiresAt: ts("expires_at").notNull(),
  usedAt: ts("used_at"),
  createdAt: createdAt(),
});

/** Objetos del simulador local de pagos (PAYMENTS_DRIVER=fake). Nunca se usa en producción. */
export const fakeProviderObjects = pgTable("fake_provider_objects", {
  id: text("id").primaryKey(),
  kind: text("kind", { enum: ["order", "preference", "payment"] }).notNull(),
  externalReference: text("external_reference"),
  data: jsonb("data").notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

// ───────────────────────── Contenido y configuración ─────────────────────────

export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: updatedAt(),
  updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
});

export const banners = pgTable("banners", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: text("title").notNull(),
  subtitle: text("subtitle").notNull().default(""),
  ctaLabel: text("cta_label").notNull().default("Ver productos"),
  ctaHref: text("cta_href").notNull().default("/productos"),
  imageId: uuid("image_id").references(() => media.id, { onDelete: "set null" }),
  isActive: boolean("is_active").notNull().default(true),
  sort: integer("sort").notNull().default(0),
  createdAt: createdAt(),
});

export const faqs = pgTable("faqs", {
  id: uuid("id").primaryKey().defaultRandom(),
  question: text("question").notNull(),
  answerHtml: text("answer_html").notNull(),
  sort: integer("sort").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
});

export const pages = pgTable("pages", {
  slug: text("slug").primaryKey(),
  title: text("title").notNull(),
  bodyHtml: text("body_html").notNull().default(""),
  /** true = contenido pendiente de revisión por el propietario (se muestra aviso). */
  isPending: boolean("is_pending").notNull().default(true),
  showInFooter: boolean("show_in_footer").notNull().default(true),
  updatedAt: updatedAt(),
});

export const emailOutbox = pgTable(
  "email_outbox",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    dedupeKey: text("dedupe_key").notNull().unique(),
    to: text("to").notNull(),
    subject: text("subject").notNull(),
    text: text("text").notNull(),
    html: text("html"),
    status: text("status", { enum: ["pending", "sent", "failed", "skipped"] }).notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    nextAttemptAt: ts("next_attempt_at").notNull().defaultNow(),
    sentAt: ts("sent_at"),
    createdAt: createdAt(),
  },
  (t) => [index("email_outbox_status_idx").on(t.status, t.nextAttemptAt)],
);

export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    entity: text("entity").notNull(),
    entityId: text("entity_id"),
    data: jsonb("data").notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [index("audit_entity_idx").on(t.entity, t.entityId)],
);

export const analyticsEvents = pgTable(
  "analytics_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name", { enum: ["view_product", "add_to_cart", "begin_checkout", "purchase"] }).notNull(),
    dedupeKey: text("dedupe_key").unique(),
    productId: uuid("product_id"),
    orderId: uuid("order_id"),
    valueCents: money("value_cents"),
    createdAt: createdAt(),
  },
  (t) => [index("analytics_name_idx").on(t.name, t.createdAt)],
);

/** Consultas de contacto y pedidos de presupuesto (productos sin precio determinable). */
export const inquiries = pgTable(
  "inquiries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: text("kind", { enum: ["contact", "quote"] }).notNull(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    phone: text("phone"),
    productId: uuid("product_id").references(() => products.id, { onDelete: "set null" }),
    message: text("message").notNull(),
    status: text("status", { enum: ["new", "answered", "archived"] }).notNull().default("new"),
    createdAt: createdAt(),
  },
  (t) => [index("inquiries_status_idx").on(t.status, t.createdAt)],
);
