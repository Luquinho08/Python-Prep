import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { categories } from "@/lib/db/schema";
import { CatalogView } from "@/components/store/catalog-view";

async function getCategory(slug: string) {
  const [c] = await db.select().from(categories).where(and(eq(categories.slug, slug), eq(categories.isActive, true)));
  return c ?? null;
}

export async function generateMetadata(props: PageProps<"/categorias/[slug]">): Promise<Metadata> {
  const c = await getCategory((await props.params).slug);
  return c ? { title: c.name, description: c.description || undefined, alternates: { canonical: `/categorias/${c.slug}` } } : {};
}

export default async function CategoryPage(props: PageProps<"/categorias/[slug]">) {
  const { slug } = await props.params;
  const c = await getCategory(slug);
  if (!c) notFound();
  return <CatalogView title={c.name} description={c.description} basePath={`/categorias/${c.slug}`} searchParams={await props.searchParams} fixed={{ categorySlug: c.slug }} />;
}
