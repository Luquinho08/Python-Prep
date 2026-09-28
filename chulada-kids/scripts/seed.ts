/**
 * Seed de DESARROLLO. Idempotente (upsert por slug/sku/código). Se niega a correr en producción.
 * Uso: pnpm db:seed   (requiere SEED_USER_PASSWORD para crear usuarios de prueba)
 */
import "dotenv/config";
import { and, eq, sql } from "drizzle-orm";
import sharp from "sharp";
import { db, sqlClient } from "../src/lib/db";
import * as s from "../src/lib/db/schema";
import { hashPassword } from "../src/lib/auth/password";
import { saveUpload } from "../src/lib/storage";
import { saveStoreSettings, storeSettingsSchema } from "../src/lib/content/settings";
import { placeholderSvg } from "./lib/placeholder";

if (process.env.NODE_ENV === "production") {
  console.error("El seed de demostración no se ejecuta en producción.");
  process.exit(1);
}

const DAY = 86400_000;
const now = new Date();

async function placeholder(title: string, motif: Parameters<typeof placeholderSvg>[0]["motif"], accent: any, bg: any, w = 1000, h = 1000) {
  const png = await sharp(Buffer.from(placeholderSvg({ title, motif, accent, bg, w, h }))).png().toBuffer();
  const row = await saveUpload({
    data: png,
    visibility: "public",
    allowed: ["image/png"],
    maxBytes: 10 * 1024 * 1024,
    alt: `${title} (imagen de demostración)`,
    isPlaceholder: true,
  });
  return row.id;
}

async function upsertCategory(slug: string, name: string, description: string, sort: number, motif: any, accent: any) {
  const [existing] = await db.select().from(s.categories).where(eq(s.categories.slug, slug));
  if (existing) return existing.id;
  const imageId = await placeholder(name, motif, accent, "mint", 800, 800);
  const [row] = await db.insert(s.categories).values({ slug, name, description, sort, imageId }).returning();
  return row.id;
}

async function upsertTheme(slug: string, name: string, description: string, sort: number) {
  const [row] = await db
    .insert(s.themes)
    .values({ slug, name, description, sort })
    .onConflictDoUpdate({ target: s.themes.slug, set: { name, description } })
    .returning();
  return row.id;
}

type Field = Omit<typeof s.personalizationFields.$inferInsert, "productId">;
type ProductSeed = {
  slug: string;
  sku: string;
  name: string;
  short: string;
  long: string;
  price: number;
  packUnits?: number;
  unitLabel?: string;
  mode?: "stock" | "capacity";
  status?: "draft" | "published";
  production?: [number, number];
  contents?: string;
  materials?: string;
  dimensions?: string;
  featured?: number;
  quote?: boolean;
  approval?: boolean;
  tags: string[];
  categories: string[];
  themes: string[];
  variants: { sku: string; name: string; price?: number; stock: number }[];
  fields?: Field[];
  motif: any;
  accent: any;
  bg: any;
  minQty?: number;
};

async function upsertProduct(p: ProductSeed, catIds: Record<string, string>, themeIds: Record<string, string>) {
  const values = {
    slug: p.slug,
    sku: p.sku,
    name: p.name,
    shortDescription: p.short,
    longDescriptionHtml: p.long,
    status: p.status ?? "published",
    basePriceCents: p.price,
    packUnits: p.packUnits ?? 1,
    unitLabel: p.unitLabel ?? "unidad",
    minQty: p.minQty ?? 1,
    inventoryMode: p.mode ?? "stock",
    productionDaysMin: p.production?.[0] ?? 0,
    productionDaysMax: p.production?.[1] ?? 0,
    packContents: p.contents ?? "",
    materials: p.materials ?? "",
    dimensions: p.dimensions ?? "",
    deliveryNotes: "Retiro o envío según zonas configuradas. El plazo de entrega se suma al de elaboración.",
    isFeatured: p.featured !== undefined,
    featuredSort: p.featured ?? 0,
    isQuoteOnly: p.quote ?? false,
    requiresDesignApproval: p.approval ?? false,
    tags: p.tags,
    isDemo: true,
    publishedAt: (p.status ?? "published") === "published" ? now : null,
  };
  const [existing] = await db.select().from(s.products).where(eq(s.products.slug, p.slug));
  let id: string;
  if (existing) {
    id = existing.id;
  } else {
    const [row] = await db.insert(s.products).values(values).returning();
    id = row.id;
    const img1 = await placeholder(p.name, p.motif, p.accent, p.bg);
    const img2 = await placeholder(`${p.name} · detalle`, p.motif, p.bg === "mint" ? "lavender" : "coral", "yellow");
    await db.insert(s.productImages).values([
      { productId: id, mediaId: img1, alt: `${p.name} (imagen de demostración)`, sort: 0 },
      { productId: id, mediaId: img2, alt: `${p.name}, vista de detalle (imagen de demostración)`, sort: 1 },
    ]);
    await db.insert(s.productCategories).values(p.categories.map((c, i) => ({ productId: id, categoryId: catIds[c], isPrimary: i === 0 })));
    if (p.themes.length) await db.insert(s.productThemes).values(p.themes.map((t) => ({ productId: id, themeId: themeIds[t] })));
    if (p.fields?.length) await db.insert(s.personalizationFields).values(p.fields.map((f) => ({ ...f, productId: id })));
  }
  for (const [i, v] of p.variants.entries()) {
    await db
      .insert(s.productVariants)
      .values({ productId: id, sku: v.sku, name: v.name, priceCents: v.price ?? null, stockOnHand: v.stock, sort: i })
      .onConflictDoNothing({ target: s.productVariants.sku });
  }
  return id;
}

async function main() {
  console.log("Sembrando datos de demostración…");

  // ── Usuarios de prueba (contraseña desde entorno; nunca fija en el código)
  const pwd = process.env.SEED_USER_PASSWORD;
  if (pwd) {
    const hash = await hashPassword(pwd);
    const people: [string, string, (typeof s.userRole.enumValues)[number]][] = [
      ["owner@chulada.test", "Propietaria Demo", "owner"],
      ["editor@chulada.test", "Editor Demo", "catalog_editor"],
      ["operador@chulada.test", "Operador Demo", "order_operator"],
      ["cliente@chulada.test", "Cliente Demo", "customer"],
    ];
    for (const [email, name, role] of people) {
      await db
        .insert(s.users)
        .values({ email, name, role, passwordHash: hash, emailVerifiedAt: now })
        .onConflictDoUpdate({ target: s.users.email, set: { role, passwordHash: hash } });
    }
    console.log("Usuarios de prueba: owner@, editor@, operador@, cliente@chulada.test (contraseña = SEED_USER_PASSWORD)");
  } else {
    console.log("SEED_USER_PASSWORD no definida: no se crean usuarios. Usá `pnpm user:create` para el propietario.");
  }

  // ── Categorías y matriz de complementarios
  const cat: Record<string, string> = {
    etiquetas: await upsertCategory("etiquetas", "Etiquetas", "Etiquetas escolares y para personalizar objetos.", 1, "labels", "blue"),
    tarjetas: await upsertCategory("tarjetas", "Tarjetas", "Tarjetas de agradecimiento y saludo.", 2, "cards", "lavender"),
    invitaciones: await upsertCategory("invitaciones", "Invitaciones", "Invitaciones impresas para cumpleaños y eventos.", 3, "invite", "coral"),
    sobres: await upsertCategory("sobres-y-stickers", "Sobres y stickers", "Sobres, stickers y detalles para cerrar tus envíos.", 4, "envelope", "lavender"),
    cajas: await upsertCategory("cajas", "Cajas", "Cajas para regalos, sorpresas y souvenirs.", 5, "box", "coral"),
    toppers: await upsertCategory("toppers", "Toppers", "Toppers para tortas y mesas dulces.", 6, "topper", "yellow"),
    kits: await upsertCategory("kits", "Kits de cumpleaños", "Kits coordinados listos para celebrar.", 7, "kit", "blue"),
  };
  const matrix: [string, string, number][] = [
    ["cajas", "etiquetas", 1],
    ["cajas", "tarjetas", 2],
    ["cajas", "sobres", 3],
    ["invitaciones", "sobres", 1],
    ["invitaciones", "tarjetas", 2],
    ["kits", "toppers", 1],
    ["kits", "cajas", 2],
    ["kits", "etiquetas", 3],
    ["toppers", "kits", 1],
    ["etiquetas", "cajas", 1],
    ["tarjetas", "sobres", 1],
  ];
  for (const [a, b, sort] of matrix) {
    await db.insert(s.categoryComplements).values({ categoryId: cat[a], complementCategoryId: cat[b], sort }).onConflictDoNothing();
  }

  // ── Temáticas genéricas originales
  const th: Record<string, string> = {
    dino: await upsertTheme("dino-aventura", "Dino aventura", "Dinosaurios simpáticos en verdes y amarillos.", 1),
    bosque: await upsertTheme("bosque-encantado", "Bosque encantado", "Hojas, hongos y animalitos del bosque.", 2),
    arcoiris: await upsertTheme("arcoiris-pastel", "Arcoíris pastel", "Arcoíris y nubes en tonos suaves.", 3),
    espacio: await upsertTheme("espacio-y-estrellas", "Espacio y estrellas", "Planetas, cohetes y estrellas.", 4),
  };

  const nameField: Field = { key: "nombre", label: "Nombre", type: "text", required: true, maxLength: 20, helpText: "Así aparecerá impreso. Revisá mayúsculas y tildes.", sort: 1 };

  const productsData: ProductSeed[] = [
    {
      slug: "etiquetas-escolares-personalizadas", sku: "ETQ-ESC", name: "Etiquetas escolares personalizadas",
      short: "Pack de etiquetas autoadhesivas con el nombre para útiles y cuadernos.",
      long: "<p>Etiquetas autoadhesivas para identificar útiles, cuadernos y loncheras.</p><p>Diseño impreso con el nombre que indiques.</p>",
      price: 890000, packUnits: 48, unitLabel: "etiquetas", mode: "capacity", production: [3, 5], featured: 1,
      contents: "48 etiquetas en 3 tamaños.", materials: "Vinilo autoadhesivo mate.", dimensions: "Tamaños aprox.: 6×1,5 cm, 4×1 cm y 3 cm de diámetro.",
      tags: ["escolar", "nombre", "cumple"], categories: ["etiquetas"], themes: ["dino", "arcoiris", "espacio"],
      variants: [{ sku: "ETQ-ESC-48", name: "Pack 48 etiquetas", stock: 40 }],
      fields: [
        nameField,
        { key: "tematica", label: "Temática del diseño", type: "select", required: true, sort: 2, options: [
          { value: "dino", label: "Dino aventura" }, { value: "arcoiris", label: "Arcoíris pastel" }, { value: "espacio", label: "Espacio y estrellas" } ] },
        { key: "acabado", label: "Acabado", type: "select", required: false, sort: 3, options: [
          { value: "mate", label: "Mate" }, { value: "brillo", label: "Brillante (+ $ 1.200)", surchargeCents: 120000 } ] },
      ],
      motif: "labels", accent: "blue", bg: "mint",
    },
    {
      slug: "stickers-arcoiris", sku: "STK-ARC", name: "Stickers redondos Arcoíris",
      short: "Plancha de stickers redondos para cerrar sobres y bolsitas.",
      long: "<p>Stickers redondos con ilustraciones de arcoíris y estrellas.</p>",
      price: 350000, packUnits: 24, unitLabel: "stickers",
      contents: "24 stickers de 4 cm.", materials: "Papel autoadhesivo.", dimensions: "4 cm de diámetro.",
      tags: ["arcoiris", "cumple", "sobres"], categories: ["sobres"], themes: ["arcoiris"],
      variants: [{ sku: "STK-ARC-24", name: "Plancha 24 stickers", stock: 25 }],
      motif: "stickers", accent: "coral", bg: "yellow",
    },
    {
      slug: "tarjetas-de-agradecimiento", sku: "TAR-GRA", name: "Tarjetas de agradecimiento",
      short: "Tarjetas pequeñas para acompañar souvenirs y regalos.",
      long: "<p>Tarjetas con mensaje de agradecimiento, listas para escribir a mano.</p>",
      price: 420000, packUnits: 10, unitLabel: "tarjetas",
      contents: "10 tarjetas.", materials: "Cartulina 300 g.", dimensions: "9×5 cm.",
      tags: ["cumple", "souvenir", "arcoiris", "bosque"], categories: ["tarjetas"], themes: ["arcoiris", "bosque"],
      variants: [
        { sku: "TAR-GRA-MEN", name: "Color menta", stock: 30 },
        { sku: "TAR-GRA-LAV", name: "Color lavanda", stock: 12 },
        { sku: "TAR-GRA-MIX", name: "Surtido pastel (20 tarjetas)", price: 760000, stock: 8 },
      ],
      motif: "cards", accent: "lavender", bg: "mint",
    },
    {
      slug: "invitaciones-dino-aventura", sku: "INV-DINO", name: "Invitaciones Dino aventura",
      short: "Invitaciones impresas con nombre, edad y datos del festejo.",
      long: "<p>Invitaciones impresas personalizadas. Antes de imprimir te enviamos una prueba de diseño para aprobar.</p>",
      price: 1250000, packUnits: 10, unitLabel: "invitaciones", mode: "capacity", production: [4, 7], featured: 2, approval: true,
      contents: "Invitaciones impresas (sin sobre).", materials: "Cartulina ilustración 300 g.", dimensions: "10×15 cm.",
      tags: ["dino", "cumple", "invitacion"], categories: ["invitaciones"], themes: ["dino"],
      variants: [
        { sku: "INV-DINO-10", name: "10 invitaciones", stock: 30 },
        { sku: "INV-DINO-20", name: "20 invitaciones", price: 2200000, stock: 20 },
      ],
      fields: [
        { ...nameField, label: "Nombre de quien cumple" },
        { key: "edad", label: "Edad que cumple", type: "select", required: true, sort: 2, options: Array.from({ length: 12 }, (_, i) => ({ value: String(i + 1), label: `${i + 1} años` })) },
        { key: "fecha", label: "Fecha del evento", type: "date", required: true, minLeadDays: 10, sort: 3, helpText: "Incluye el tiempo de elaboración y entrega." },
        { key: "detalle", label: "Lugar y horario", type: "textarea", required: false, maxLength: 160, sort: 4 },
        { key: "referencia", label: "Foto o referencia", type: "file", required: false, sort: 5, acceptMime: ["image/jpeg", "image/png", "image/webp", "application/pdf"], maxFileMb: 8 },
      ],
      motif: "invite", accent: "coral", bg: "mint",
    },
    {
      slug: "invitaciones-bosque-encantado", sku: "INV-BOS", name: "Invitaciones Bosque encantado",
      short: "Invitaciones con ilustraciones del bosque, personalizadas.",
      long: "<p>Invitaciones impresas con temática de bosque.</p>",
      price: 1250000, packUnits: 10, unitLabel: "invitaciones", mode: "capacity", production: [4, 7], approval: true,
      contents: "10 invitaciones.", materials: "Cartulina 300 g.", dimensions: "10×15 cm.",
      tags: ["bosque", "cumple", "invitacion"], categories: ["invitaciones"], themes: ["bosque"],
      variants: [{ sku: "INV-BOS-10", name: "10 invitaciones", stock: 25 }],
      fields: [{ ...nameField, label: "Nombre de quien cumple" }, { key: "fecha", label: "Fecha del evento", type: "date", required: true, minLeadDays: 10, sort: 2 }],
      motif: "invite", accent: "blue", bg: "yellow",
    },
    {
      slug: "sobres-pastel", sku: "SOB-PAS", name: "Sobres pastel",
      short: "Sobres de color para invitaciones 10×15 cm.",
      long: "<p>Sobres lisos en colores pastel, a juego con invitaciones de 10×15 cm.</p>",
      price: 280000, packUnits: 10, unitLabel: "sobres",
      contents: "10 sobres.", materials: "Papel color 120 g.", dimensions: "11×16 cm.",
      tags: ["sobres", "invitacion", "dino", "bosque", "cumple"], categories: ["sobres"], themes: ["arcoiris"],
      variants: [
        { sku: "SOB-PAS-MEN", name: "Menta", stock: 40 },
        { sku: "SOB-PAS-AMA", name: "Amarillo", stock: 35 },
      ],
      motif: "envelope", accent: "blue", bg: "lavender",
    },
    {
      slug: "caja-sorpresa-arcoiris", sku: "CAJ-ARC", name: "Caja sorpresa Arcoíris",
      short: "Caja armable para souvenirs y regalitos.",
      long: "<p>Caja de cartulina armable con ilustración de arcoíris.</p>",
      price: 190000, unitLabel: "caja",
      contents: "1 caja armable.", materials: "Cartulina 350 g.", dimensions: "10×10×10 cm.",
      tags: ["arcoiris", "souvenir", "cumple"], categories: ["cajas"], themes: ["arcoiris"],
      variants: [{ sku: "CAJ-ARC-1", name: "Unidad", stock: 60 }], minQty: 5,
      motif: "box", accent: "coral", bg: "mint",
    },
    {
      slug: "caja-kraft-con-visor", sku: "CAJ-KRA", name: "Caja kraft con visor",
      short: "Caja kraft con ventana transparente.",
      long: "<p>Caja kraft con visor para mostrar el contenido.</p>",
      price: 240000, unitLabel: "caja",
      contents: "1 caja.", materials: "Cartulina kraft y acetato.", dimensions: "12×8×5 cm.",
      tags: ["souvenir", "cumple"], categories: ["cajas"], themes: [],
      variants: [{ sku: "CAJ-KRA-1", name: "Unidad", stock: 0 }],
      motif: "box", accent: "lavender", bg: "yellow",
    },
    {
      slug: "toppers-dino-aventura", sku: "TOP-DINO", name: "Toppers Dino aventura",
      short: "Set de toppers para torta con nombre opcional.",
      long: "<p>Toppers impresos y troquelados con palillos.</p>",
      price: 650000, packUnits: 6, unitLabel: "toppers", mode: "capacity", production: [2, 4],
      contents: "1 topper principal + 5 chicos.", materials: "Cartulina 300 g y palillos de madera.", dimensions: "Topper principal 15 cm.",
      tags: ["dino", "cumple", "torta"], categories: ["toppers"], themes: ["dino"],
      variants: [{ sku: "TOP-DINO-6", name: "Set 6 toppers", stock: 15 }],
      fields: [{ ...nameField, required: false, label: "Nombre en el topper", surchargeCents: 50000, helpText: "Agregar nombre suma $ 500." }],
      motif: "topper", accent: "yellow", bg: "mint",
    },
    {
      slug: "toppers-espacio", sku: "TOP-ESP", name: "Toppers Espacio y estrellas",
      short: "Toppers de planetas y cohetes.",
      long: "<p>Set de toppers con planetas, cohetes y estrellas.</p>",
      price: 600000, packUnits: 6, unitLabel: "toppers",
      contents: "6 toppers.", materials: "Cartulina 300 g.", dimensions: "8 a 15 cm.",
      tags: ["espacio", "cumple", "torta"], categories: ["toppers"], themes: ["espacio"],
      variants: [{ sku: "TOP-ESP-6", name: "Set 6 toppers", stock: 10 }],
      motif: "topper", accent: "blue", bg: "lavender",
    },
    {
      slug: "kit-cumple-dino-aventura", sku: "KIT-DINO", name: "Kit de cumpleaños Dino aventura",
      short: "Kit prearmado: banderín, toppers, etiquetas y cajitas.",
      long: "<p>Kit prearmado con piezas coordinadas. El stock es del kit completo.</p>",
      price: 3200000, unitLabel: "kit", featured: 3,
      contents: "1 banderín, 6 toppers, 24 etiquetas redondas y 10 cajitas.", materials: "Cartulina y papel autoadhesivo.", dimensions: "Banderín 2 m.",
      tags: ["dino", "cumple", "kit"], categories: ["kits"], themes: ["dino"],
      variants: [{ sku: "KIT-DINO-1", name: "Kit completo", stock: 3 }],
      motif: "kit", accent: "coral", bg: "yellow",
    },
    {
      slug: "kit-cumple-bosque-encantado", sku: "KIT-BOS", name: "Kit de cumpleaños Bosque encantado",
      short: "Kit a pedido con piezas del bosque.",
      long: "<p>Kit elaborado a pedido con piezas coordinadas.</p>",
      price: 3400000, unitLabel: "kit", mode: "capacity", production: [5, 8],
      contents: "1 banderín, 6 toppers y 10 bolsitas.", materials: "Cartulina y papel.", dimensions: "Banderín 2 m.",
      tags: ["bosque", "cumple", "kit"], categories: ["kits"], themes: ["bosque"],
      variants: [{ sku: "KIT-BOS-1", name: "Kit completo", stock: 5 }],
      fields: [{ ...nameField, label: "Nombre para el banderín", maxLength: 14 }],
      motif: "kit", accent: "lavender", bg: "mint",
    },
    {
      slug: "papeleria-a-medida", sku: "MED-001", name: "Papelería completa a medida",
      short: "Diseño integral para tu evento. Se cotiza según piezas y cantidades.",
      long: "<p>Diseñamos la papelería completa de tu evento. Contanos qué necesitás y te enviamos un presupuesto.</p>",
      price: 0, unitLabel: "proyecto", quote: true,
      tags: ["a medida", "evento"], categories: ["kits"], themes: [],
      variants: [{ sku: "MED-001-1", name: "Proyecto", stock: 0 }],
      motif: "kit", accent: "blue", bg: "lavender",
    },
    {
      slug: "agenda-2027-borrador", sku: "AGE-2027", name: "Agenda 2027 (borrador)", status: "draft",
      short: "Producto en preparación: no debe verse en la tienda.",
      long: "<p>Borrador.</p>", price: 1500000, unitLabel: "agenda",
      tags: ["agenda"], categories: ["tarjetas"], themes: [],
      variants: [{ sku: "AGE-2027-1", name: "Unidad", stock: 10 }],
      motif: "cards", accent: "yellow", bg: "mint",
    },
  ];

  const pid: Record<string, string> = {};
  for (const p of productsData) pid[p.slug] = await upsertProduct(p, cat, th);

  // ── Complementarios manuales (3 coherentes)
  const relations: [string, string, number][] = [
    ["invitaciones-dino-aventura", "sobres-pastel", 1],
    ["invitaciones-dino-aventura", "stickers-arcoiris", 2],
    ["caja-sorpresa-arcoiris", "tarjetas-de-agradecimiento", 1],
    ["kit-cumple-dino-aventura", "toppers-dino-aventura", 1],
  ];
  for (const [a, b, sort] of relations) {
    await db.insert(s.productRelations).values({ productId: pid[a], relatedProductId: pid[b], sort }).onConflictDoNothing();
  }

  // ── Promociones: vigente, futura, vencida
  const promos = [
    { name: "Semana arcoíris", kind: "percent" as const, value: 1500, starts: new Date(now.getTime() - 2 * DAY), ends: new Date(now.getTime() + 10 * DAY), products: ["caja-sorpresa-arcoiris", "stickers-arcoiris"] },
    { name: "Toppers espaciales (próxima)", kind: "percent" as const, value: 1000, starts: new Date(now.getTime() + 5 * DAY), ends: new Date(now.getTime() + 20 * DAY), products: ["toppers-espacio"] },
    { name: "Liquidación bosque (vencida)", kind: "percent" as const, value: 2000, starts: new Date(now.getTime() - 20 * DAY), ends: new Date(now.getTime() - 3 * DAY), products: ["kit-cumple-bosque-encantado"] },
  ];
  for (const p of promos) {
    const [existing] = await db.select().from(s.promotions).where(eq(s.promotions.name, p.name));
    if (existing) continue;
    const [row] = await db
      .insert(s.promotions)
      .values({ name: p.name, kind: p.kind, value: p.value, scope: "products", startsAt: p.starts, endsAt: p.ends })
      .returning();
    await db.insert(s.promotionProducts).values(p.products.map((slug) => ({ promotionId: row.id, productId: pid[slug] })));
  }

  // ── Cupones
  await db
    .insert(s.coupons)
    .values([
      { code: "BIENVENIDA10", description: "10 % en tu primera compra desde $ 20.000 (no combinable con promociones).", kind: "percent", value: 1000, minSubtotalCents: 2000000, maxUses: 100, maxUsesPerCustomer: 1 },
      { code: "UNICO1", description: "Cupón de prueba con un solo uso total.", kind: "fixed", value: 100000, maxUses: 1, maxUsesPerCustomer: 1, combinableWithPromotions: true },
    ])
    .onConflictDoNothing({ target: s.coupons.code });

  // ── Entregas (valores de demostración: el propietario debe reemplazarlos)
  const shippingCount = await db.select({ n: sql<number>`count(*)::int` }).from(s.shippingMethods);
  if (Number(shippingCount[0].n) === 0) {
    await db.insert(s.shippingMethods).values([
      { name: "Retiro en punto de entrega", kind: "pickup", description: "Coordinamos día y horario por email cuando el pedido esté listo. Dirección pendiente de configurar.", priceCents: 0, sort: 1 },
      { name: "Envío a domicilio CABA (demo)", kind: "delivery", description: "Valor de demostración.", postalCodes: ["1000-1499"], priceCents: 450000, deliveryDaysMin: 1, deliveryDaysMax: 3, sort: 2 },
      { name: "Envío a domicilio GBA (demo)", kind: "delivery", description: "Valor de demostración.", postalCodes: ["1600-1899"], priceCents: 650000, deliveryDaysMin: 2, deliveryDaysMax: 5, sort: 3 },
    ]);
  }

  // ── Contenido
  const bannerCount = await db.select({ n: sql<number>`count(*)::int` }).from(s.banners);
  if (Number(bannerCount[0].n) === 0) {
    const img = await placeholder("Papelería para celebrar", "banner", "blue", "mint", 1600, 700);
    await db.insert(s.banners).values({ title: "Papelería para celebrar", subtitle: "Etiquetas, invitaciones, toppers y kits personalizados.", ctaLabel: "Ver productos", ctaHref: "/productos", imageId: img });
  }
  const faqCount = await db.select({ n: sql<number>`count(*)::int` }).from(s.faqs);
  if (Number(faqCount[0].n) === 0) {
    await db.insert(s.faqs).values([
      { question: "¿Cómo envío los datos de personalización?", answerHtml: "<p>Los completás en la ficha del producto antes de agregarlo al carrito. Quedan guardados en tu pedido.</p>", sort: 1 },
      { question: "¿Cuánto tarda mi pedido?", answerHtml: "<p>Cada producto indica su tiempo de elaboración. El tiempo de entrega depende del método elegido y se suma después.</p>", sort: 2 },
      { question: "¿Cómo pago?", answerHtml: "<p>Con tarjeta de crédito o débito, o con tu cuenta de Mercado Pago. Los pagos los procesa Mercado Pago.</p>", sort: 3 },
    ]);
  }
  const policyPages = [
    ["terminos-y-condiciones", "Términos y condiciones"],
    ["politica-de-privacidad", "Política de privacidad"],
    ["cambios-y-devoluciones", "Cambios y devoluciones"],
    ["envios-y-retiros", "Envíos y retiros"],
  ];
  for (const [slug, title] of policyPages) {
    await db
      .insert(s.pages)
      .values({ slug, title, bodyHtml: "<p><strong>Contenido pendiente:</strong> el propietario debe redactar esta política antes de publicar la tienda.</p>", isPending: true })
      .onConflictDoNothing();
  }

  const current = await db.select().from(s.settings).where(eq(s.settings.key, "store"));
  if (current.length === 0) {
    const [dino] = await db.select().from(s.themes).where(and(eq(s.themes.slug, "dino-aventura")));
    await saveStoreSettings(
      storeSettingsSchema.parse({
        contactEmail: "hola@example.com",
        whatsapp: "",
        announcementEnabled: true,
        announcementText: "Tienda en modo demostración: los productos y precios son de prueba.",
        featuredThemeId: dino?.id ?? null,
        checkoutEnabled: true,
        noindexSite: true,
      }),
      null,
    );
  }

  console.log("Listo.");
}

main()
  .then(() => sqlClient.end())
  .catch(async (e) => {
    console.error(e);
    await sqlClient.end();
    process.exit(1);
  });
