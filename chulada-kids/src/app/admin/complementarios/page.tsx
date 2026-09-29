import Link from "next/link";
import { asc, eq } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/lib/db";
import { categories, categoryComplements, productRelations, products } from "@/lib/db/schema";
import { requirePagePermission } from "@/lib/auth/guards";
import { Card, FlashFromParams, PageHeader, Table } from "@/components/admin/ui";
import { SubmitButton } from "@/components/ui/submit-button";
import { saveMatrixAction } from "../categorias/actions";

export default async function ComplementsPage(props: PageProps<"/admin/complementarios">) {
  await requirePagePermission("catalog:write");
  const related = alias(products, "related");
  const [cats, matrix, manual] = await Promise.all([
    db.select().from(categories).orderBy(asc(categories.sort)),
    db.select().from(categoryComplements),
    db
      .select({ from: products.name, fromId: products.id, to: related.name, sort: productRelations.sort })
      .from(productRelations)
      .innerJoin(products, eq(products.id, productRelations.productId))
      .innerJoin(related, eq(related.id, productRelations.relatedProductId))
      .orderBy(asc(products.name), asc(productRelations.sort)),
  ]);
  const has = (a: string, b: string) => matrix.some((m) => m.categoryId === a && m.complementCategoryId === b);
  return (
    <div className="space-y-6">
      <PageHeader
        title="Complementarios"
        description="Prioridad: 1) asociaciones manuales (se editan en cada producto), 2) reglas automáticas = categoría compatible según esta matriz Y al menos una temática o etiqueta compartida. Si no hay complementos válidos, el bloque no se muestra."
      />
      <FlashFromParams sp={await props.searchParams} />
      <Card title="Matriz de categorías compatibles">
        <p className="mb-3 text-sm text-ink-soft">Fila = producto que se está viendo; columna = categoría que se sugiere. No es simétrica.</p>
        <form action={saveMatrixAction}>
          <Table>
            <thead>
              <tr><th>Viendo ↓ / Sugerir →</th>{cats.map((c) => <th key={c.id} className="text-xs">{c.name}</th>)}</tr>
            </thead>
            <tbody>
              {cats.map((a) => (
                <tr key={a.id}>
                  <th scope="row" className="text-xs">{a.name}</th>
                  {cats.map((b) => (
                    <td key={b.id} className="text-center">
                      {a.id === b.id ? "—" : (
                        <input type="checkbox" name="pair" value={`${a.id}:${b.id}`} defaultChecked={has(a.id, b.id)} aria-label={`${a.name} sugiere ${b.name}`} className="h-4 w-4" />
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </Table>
          <SubmitButton className="mt-3">Guardar matriz</SubmitButton>
        </form>
      </Card>
      <Card title="Asociaciones manuales">
        {manual.length ? (
          <ul className="space-y-1 text-sm">
            {manual.map((m) => (
              <li key={`${m.fromId}-${m.to}`}>
                <Link className="underline" href={`/admin/productos/${m.fromId}#complementarios`}>{m.from}</Link> → {m.to}
              </li>
            ))}
          </ul>
        ) : <p className="text-sm">No hay asociaciones manuales.</p>}
      </Card>
    </div>
  );
}
