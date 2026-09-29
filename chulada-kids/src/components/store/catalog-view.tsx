import Form from "next/form";
import Link from "next/link";
import { listActiveCategories, listActiveThemes, searchCatalog, searchSuggestions, type CatalogQuery, type CatalogSort } from "@/lib/catalog/queries";
import { parsePesosInput } from "@/lib/money";
import { ProductGrid } from "./product-card";
import { EmptyState } from "../ui/empty-state";
import { ButtonLink, buttonClasses } from "../ui/button";
import { inputClasses } from "../ui/field";

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export function parseCatalogParams(sp: SP): CatalogQuery & { raw: Record<string, string> } {
  const raw: Record<string, string> = {};
  for (const k of ["q", "categoria", "tematica", "min", "max", "disponible", "personalizable", "promo", "orden", "pagina"]) {
    const v = one(sp[k]).slice(0, 80);
    if (v) raw[k] = v;
  }
  const sorts: CatalogSort[] = ["relevancia", "novedades", "precio-asc", "precio-desc"];
  return {
    raw,
    q: raw.q,
    categorySlug: raw.categoria,
    themeSlug: raw.tematica,
    minPriceCents: raw.min ? (parsePesosInput(raw.min) ?? undefined) : undefined,
    maxPriceCents: raw.max ? (parsePesosInput(raw.max) ?? undefined) : undefined,
    onlyAvailable: raw.disponible === "1",
    onlyPersonalizable: raw.personalizable === "1",
    onlyPromotions: raw.promo === "1",
    sort: sorts.includes(raw.orden as CatalogSort) ? (raw.orden as CatalogSort) : "relevancia",
    page: Math.max(1, Number(raw.pagina) || 1),
  };
}

function hrefWith(base: string, raw: Record<string, string>, patch: Record<string, string | null>) {
  const params = new URLSearchParams(raw);
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) params.delete(k);
    else params.set(k, v);
  }
  const qs = params.toString();
  return qs ? `${base}?${qs}` : base;
}

export async function CatalogView({
  title,
  description,
  basePath,
  searchParams,
  fixed = {},
}: {
  title: string;
  description?: string;
  basePath: string;
  searchParams: SP;
  fixed?: Partial<CatalogQuery>;
}) {
  const parsed = parseCatalogParams(searchParams);
  const query: CatalogQuery = { ...parsed, ...fixed };
  const [result, categories, themes] = await Promise.all([searchCatalog(query), listActiveCategories(), listActiveThemes()]);
  const suggestions = result.total === 0 && query.q ? await searchSuggestions(query.q) : [];
  const activeFilters = ["categoria", "tematica", "min", "max", "disponible", "personalizable", "promo"].filter((k) => parsed.raw[k]).length;
  const { raw } = parsed;

  const filters = (
    <Form action={basePath} className="space-y-5">
      {raw.q ? <input type="hidden" name="q" value={raw.q} /> : null}
      {!fixed.categorySlug ? (
        <div>
          <label htmlFor="f-categoria" className="text-sm font-semibold">Categoría</label>
          <select id="f-categoria" name="categoria" defaultValue={raw.categoria ?? ""} className={`${inputClasses} mt-1.5`}>
            <option value="">Todas</option>
            {categories.map((c) => <option key={c.id} value={c.slug}>{c.name}</option>)}
          </select>
        </div>
      ) : null}
      <div>
        <label htmlFor="f-tematica" className="text-sm font-semibold">Ocasión o temática</label>
        <select id="f-tematica" name="tematica" defaultValue={raw.tematica ?? ""} className={`${inputClasses} mt-1.5`}>
          <option value="">Todas</option>
          {themes.map((t) => <option key={t.id} value={t.slug}>{t.name}</option>)}
        </select>
      </div>
      <fieldset>
        <legend className="text-sm font-semibold">Precio (ARS)</legend>
        <div className="mt-1.5 grid grid-cols-2 gap-2">
          <div>
            <label htmlFor="f-min" className="text-xs text-ink-soft">Mínimo</label>
            <input id="f-min" name="min" inputMode="numeric" defaultValue={raw.min ?? ""} className={inputClasses} placeholder="0" />
          </div>
          <div>
            <label htmlFor="f-max" className="text-xs text-ink-soft">Máximo</label>
            <input id="f-max" name="max" inputMode="numeric" defaultValue={raw.max ?? ""} className={inputClasses} placeholder="Sin límite" />
          </div>
        </div>
      </fieldset>
      <fieldset className="space-y-2">
        <legend className="text-sm font-semibold">Mostrar solo</legend>
        {[
          ["disponible", "Con disponibilidad"],
          ["personalizable", "Personalizables"],
          ...(fixed.onlyPromotions ? [] : [["promo", "En promoción"]]),
        ].map(([name, label]) => (
          <label key={name} className="flex items-center gap-2 text-sm">
            <input type="checkbox" name={name} value="1" defaultChecked={raw[name] === "1"} className="h-5 w-5 accent-[#235b91]" />
            {label}
          </label>
        ))}
      </fieldset>
      <div>
        <label htmlFor="f-orden" className="text-sm font-semibold">Ordenar por</label>
        <select id="f-orden" name="orden" defaultValue={raw.orden ?? "relevancia"} className={`${inputClasses} mt-1.5`}>
          <option value="relevancia">Relevancia</option>
          <option value="novedades">Novedades</option>
          <option value="precio-asc">Menor precio</option>
          <option value="precio-desc">Mayor precio</option>
        </select>
      </div>
      <div className="flex gap-2">
        <button type="submit" className={buttonClasses("primary", "md", "flex-1")}>Aplicar</button>
        <Link href={raw.q ? `${basePath}?q=${encodeURIComponent(raw.q)}` : basePath} className={buttonClasses("secondary", "md")}>Limpiar</Link>
      </div>
    </Form>
  );

  return (
    <div className="mx-auto max-w-7xl px-4 py-6">
      <nav aria-label="Ruta" className="text-xs text-ink-soft">
        <Link href="/" className="hover:underline">Inicio</Link> <span aria-hidden="true">/</span> <span>{title}</span>
      </nav>
      <div className="mt-2 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold sm:text-3xl">{query.q ? `Resultados para “${query.q}”` : title}</h1>
          {description ? <p className="mt-1 text-sm text-ink-soft">{description}</p> : null}
        </div>
        <p className="text-sm text-ink-soft" aria-live="polite">
          {result.total} {result.total === 1 ? "producto" : "productos"}
        </p>
      </div>

      <div className="mt-5 lg:grid lg:grid-cols-[250px_minmax(0,1fr)] lg:gap-8">
        <details className="mb-4 rounded-2xl border border-line bg-white lg:hidden" open={false}>
          <summary className="flex min-h-12 cursor-pointer items-center justify-between px-4 font-semibold">
            Filtrar y ordenar {activeFilters ? `(${activeFilters} activos)` : ""}
            <span aria-hidden="true">▾</span>
          </summary>
          <div className="border-t border-line p-4">{filters}</div>
        </details>
        <aside aria-label="Filtros" className="hidden lg:block">{filters}</aside>

        <div>
          {result.total === 0 ? (
            <EmptyState
              title="No encontramos productos"
              action={<ButtonLink href="/productos" variant="secondary">Ver todo el catálogo</ButtonLink>}
            >
              <p>Probá con otra palabra, revisá la ortografía o quitá algunos filtros.</p>
              {suggestions.length ? (
                <div className="mt-3">
                  <p className="font-semibold text-ink">Quizás buscabas:</p>
                  <ul className="mt-1 flex flex-wrap justify-center gap-2">
                    {suggestions.map((s) => (
                      <li key={s.href}><Link className="rounded-full bg-brand-mint/60 px-3 py-1 text-ink hover:underline" href={s.href}>{s.label}</Link></li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </EmptyState>
          ) : (
            <>
              <ProductGrid products={result.items} priorityCount={2} />
              {result.pageCount > 1 ? (
                <nav aria-label="Paginación" className="mt-8 flex items-center justify-center gap-2">
                  {result.page > 1 ? (
                    <Link className={buttonClasses("secondary", "sm")} href={hrefWith(basePath, raw, { pagina: String(result.page - 1) })} rel="prev">Anterior</Link>
                  ) : null}
                  <span className="px-3 text-sm" aria-current="page">Página {result.page} de {result.pageCount}</span>
                  {result.page < result.pageCount ? (
                    <Link className={buttonClasses("secondary", "sm")} href={hrefWith(basePath, raw, { pagina: String(result.page + 1) })} rel="next">Siguiente</Link>
                  ) : null}
                </nav>
              ) : null}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
