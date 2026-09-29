import type { MetadataRoute } from "next";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { categories, pages, products } from "@/lib/db/schema";

export const dynamic = "force-dynamic";

/** Solo contenido público real: productos publicados, categorías activas y páginas revisadas. */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
  const [prods, cats, pgs] = await Promise.all([
    db.select({ slug: products.slug, updatedAt: products.updatedAt }).from(products).where(eq(products.status, "published")),
    db.select({ slug: categories.slug, updatedAt: categories.updatedAt }).from(categories).where(eq(categories.isActive, true)),
    db.select({ slug: pages.slug, updatedAt: pages.updatedAt }).from(pages).where(eq(pages.isPending, false)),
  ]);
  return [
    { url: `${base}/`, changeFrequency: "daily" },
    { url: `${base}/productos`, changeFrequency: "daily" },
    { url: `${base}/promociones` },
    { url: `${base}/destacados` },
    { url: `${base}/como-comprar` },
    { url: `${base}/preguntas-frecuentes` },
    { url: `${base}/contacto` },
    ...cats.map((c) => ({ url: `${base}/categorias/${c.slug}`, lastModified: c.updatedAt })),
    ...prods.map((p) => ({ url: `${base}/productos/${p.slug}`, lastModified: p.updatedAt })),
    ...pgs.map((p) => ({ url: `${base}/politicas/${p.slug}`, lastModified: p.updatedAt })),
  ];
}
