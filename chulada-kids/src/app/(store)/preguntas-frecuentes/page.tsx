import type { Metadata } from "next";
import { asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { faqs } from "@/lib/db/schema";
import { sanitizeRichText } from "@/lib/content/sanitize";
import { EmptyState } from "@/components/ui/empty-state";

export const metadata: Metadata = { title: "Preguntas frecuentes", alternates: { canonical: "/preguntas-frecuentes" } };

export default async function FaqPage() {
  const rows = await db.select().from(faqs).where(eq(faqs.isActive, true)).orderBy(asc(faqs.sort));
  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="text-2xl font-bold sm:text-3xl">Preguntas frecuentes</h1>
      {rows.length === 0 ? (
        <div className="mt-6"><EmptyState title="Todavía no hay preguntas cargadas" /></div>
      ) : (
        <div className="mt-6 space-y-3">
          {rows.map((f) => (
            <details key={f.id} className="group rounded-card border border-line bg-white p-4">
              <summary className="cursor-pointer list-none font-semibold marker:hidden">
                <span className="flex items-center justify-between gap-3">
                  {f.question}
                  <span aria-hidden="true" className="transition-transform group-open:rotate-45">+</span>
                </span>
              </summary>
              <div className="prose-ck mt-3 text-sm" dangerouslySetInnerHTML={{ __html: sanitizeRichText(f.answerHtml) }} />
            </details>
          ))}
        </div>
      )}
    </div>
  );
}
