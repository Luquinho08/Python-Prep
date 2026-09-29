"use server";
import { and, eq, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { categories, categoryComplements, themes } from "@/lib/db/schema";
import { requirePermission } from "@/lib/auth/guards";
import { audit } from "@/lib/audit";
import { redirectError, redirectOk, zodMessage } from "@/lib/admin/flash";
import { slugify } from "@/lib/slug";

const schema = z.object({
  name: z.string().trim().min(2).max(60),
  slug: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
  description: z.string().max(300),
  sort: z.number().int(),
  isActive: z.boolean(),
});

function parse(formData: FormData) {
  const name = String(formData.get("name") ?? "");
  return schema.safeParse({
    name,
    slug: slugify(String(formData.get("slug") ?? "") || name),
    description: String(formData.get("description") ?? ""),
    sort: Number(formData.get("sort") ?? 0) || 0,
    isActive: formData.get("isActive") === "on",
  });
}

export async function saveTaxonomyAction(formData: FormData) {
  const user = await requirePermission("catalog:write");
  const kind = formData.get("kind") === "theme" ? "theme" : "category";
  const table = kind === "theme" ? themes : categories;
  const back = kind === "theme" ? "/admin/tematicas" : "/admin/categorias";
  const id = String(formData.get("id") ?? "") || null;
  const parsed = parse(formData);
  if (!parsed.success) redirectError(back, zodMessage(parsed.error.issues));
  const [dup] = await db.select({ id: table.id }).from(table).where(and(eq(table.slug, parsed.data.slug), id ? ne(table.id, id) : sql`true`));
  if (dup) redirectError(back, `El slug ${parsed.data.slug} ya existe.`);
  if (id) await db.update(table).set({ ...parsed.data, updatedAt: new Date() }).where(eq(table.id, id));
  else await db.insert(table).values(parsed.data);
  await audit(user.id, `${kind}.save`, kind, id, parsed.data);
  redirectOk(back, "Guardado.");
}

export async function deleteTaxonomyAction(formData: FormData) {
  const user = await requirePermission("catalog:write");
  const kind = formData.get("kind") === "theme" ? "theme" : "category";
  const table = kind === "theme" ? themes : categories;
  const back = kind === "theme" ? "/admin/tematicas" : "/admin/categorias";
  const id = z.string().uuid().parse(formData.get("id"));
  // Desactivar en lugar de borrar si tiene productos: evita perder asociaciones.
  const [{ n }] = await db.execute<{ n: number }>(
    kind === "theme" ? sql`SELECT count(*)::int AS n FROM product_themes WHERE theme_id = ${id}` : sql`SELECT count(*)::int AS n FROM product_categories WHERE category_id = ${id}`,
  );
  if (Number(n) > 0) {
    await db.update(table).set({ isActive: false }).where(eq(table.id, id));
    await audit(user.id, `${kind}.deactivate`, kind, id);
    redirectOk(back, "Tiene productos asociados: se desactivó (no se muestra en la tienda).");
  }
  await db.delete(table).where(eq(table.id, id));
  await audit(user.id, `${kind}.delete`, kind, id);
  redirectOk(back, "Eliminado.");
}

export async function saveMatrixAction(formData: FormData) {
  const user = await requirePermission("catalog:write");
  const pairs = formData
    .getAll("pair")
    .map(String)
    .map((p) => p.split(":"))
    .filter(([a, b]) => a && b && a !== b);
  await db.transaction(async (tx) => {
    await tx.delete(categoryComplements);
    if (pairs.length) await tx.insert(categoryComplements).values(pairs.map(([a, b], i) => ({ categoryId: a, complementCategoryId: b, sort: i })));
  });
  await audit(user.id, "complements.matrix", "category", null, { pairs: pairs.length });
  redirectOk("/admin/complementarios", "Matriz de categorías complementarias guardada.");
}
