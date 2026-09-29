import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { pages } from "@/lib/db/schema";
import { sanitizeRichText } from "@/lib/content/sanitize";
import { formatStoreDate } from "@/lib/time";
import { Alert } from "@/components/ui/alert";

async function getPage(slug: string) {
  const [p] = await db.select().from(pages).where(eq(pages.slug, slug));
  return p ?? null;
}

export async function generateMetadata(props: PageProps<"/politicas/[slug]">): Promise<Metadata> {
  const p = await getPage((await props.params).slug);
  return p ? { title: p.title, alternates: { canonical: `/politicas/${p.slug}` }, robots: p.isPending ? { index: false } : undefined } : {};
}

export default async function PolicyPage(props: PageProps<"/politicas/[slug]">) {
  const p = await getPage((await props.params).slug);
  if (!p) notFound();
  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="text-2xl font-bold sm:text-3xl">{p.title}</h1>
      {p.isPending ? <Alert tone="warning" className="mt-4" title="Contenido pendiente">Esta página todavía no fue revisada por el comercio. Consultanos ante cualquier duda.</Alert> : null}
      <div className="prose-ck mt-6" dangerouslySetInnerHTML={{ __html: sanitizeRichText(p.bodyHtml) }} />
      <p className="mt-8 text-xs text-ink-soft">Última actualización: {formatStoreDate(p.updatedAt)}</p>
    </div>
  );
}
