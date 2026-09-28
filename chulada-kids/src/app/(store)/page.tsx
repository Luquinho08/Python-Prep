import Image from "next/image";
import Link from "next/link";
import { getStoreSettings } from "@/lib/content/settings";
import { getActiveBanner, getThemeById } from "@/lib/content/home";
import { getFeaturedCards, getPromotionCards, getThemeCards, listActiveCategories } from "@/lib/catalog/queries";
import { ProductGrid } from "@/components/store/product-card";
import { ButtonLink } from "@/components/ui/button";
import { Rainbow, Star } from "@/components/ui/decor";

export default async function HomePage() {
  const settings = await getStoreSettings();
  const [banner, categories, featured, promos, theme] = await Promise.all([
    getActiveBanner(),
    listActiveCategories(),
    getFeaturedCards(8),
    getPromotionCards(8),
    getThemeById(settings.featuredThemeId),
  ]);
  const themeCards = theme ? await getThemeCards(theme.id, 4) : [];
  const visibleCategories = categories.filter((c) => c.productCount > 0);

  const sections: Record<string, React.ReactNode> = {
    hero: banner ? (
      <section key="hero" className="mx-auto max-w-7xl px-4 pt-4 sm:pt-6">
        <div className="grid items-center gap-4 overflow-hidden rounded-card bg-brand-mint/40 sm:grid-cols-2">
          <div className="p-5 sm:p-8">
            <Rainbow className="h-7 w-12" />
            <h1 className="mt-2 text-2xl font-bold leading-tight sm:text-4xl">{banner.title}</h1>
            {banner.subtitle ? <p className="mt-2 text-sm text-ink-soft sm:text-base">{banner.subtitle}</p> : null}
            <ButtonLink href={banner.ctaHref.startsWith("/") ? banner.ctaHref : "/productos"} className="mt-4" size="lg">
              {banner.ctaLabel}
            </ButtonLink>
          </div>
          {banner.imageUrl && banner.imageWidth && banner.imageHeight ? (
            <Image
              src={banner.imageUrl}
              alt={banner.imageAlt}
              width={banner.imageWidth}
              height={banner.imageHeight}
              priority
              sizes="(min-width: 640px) 50vw, 100vw"
              className="hidden max-h-72 w-full object-cover sm:block"
            />
          ) : null}
        </div>
      </section>
    ) : null,
    categories: visibleCategories.length ? (
      <section key="categories" aria-labelledby="h-categorias" className="mx-auto max-w-7xl px-4">
        <h2 id="h-categorias" className="text-xl font-bold sm:text-2xl">Categorías</h2>
        <ul className="mt-4 grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-7">
          {visibleCategories.map((c) => (
            <li key={c.id}>
              <Link href={`/categorias/${c.slug}`} className="group flex flex-col items-center gap-2 rounded-2xl p-2 text-center hover:bg-surface-soft">
                <span className="relative block aspect-square w-full overflow-hidden rounded-full bg-brand-mint/40">
                  {c.imageUrl ? <Image src={c.imageUrl} alt="" fill sizes="(min-width: 1024px) 140px, 30vw" className="object-cover" /> : null}
                </span>
                <span className="text-xs font-semibold sm:text-sm">{c.name}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    ) : null,
    featured: featured.length ? (
      <section key="featured" aria-labelledby="h-destacados" className="mx-auto max-w-7xl px-4">
        <div className="flex items-end justify-between gap-4">
          <h2 id="h-destacados" className="text-xl font-bold sm:text-2xl">Destacados</h2>
          <Link href="/destacados" className="text-sm font-semibold text-blue-strong underline-offset-4 hover:underline">Ver todos</Link>
        </div>
        <div className="mt-4"><ProductGrid products={featured} priorityCount={2} /></div>
      </section>
    ) : null,
    promotions: promos.length ? (
      <section key="promotions" aria-labelledby="h-promos" className="mx-auto max-w-7xl px-4">
        <div className="flex items-end justify-between gap-4">
          <h2 id="h-promos" className="text-xl font-bold sm:text-2xl">En promoción</h2>
          <Link href="/promociones" className="text-sm font-semibold text-blue-strong underline-offset-4 hover:underline">Ver promociones</Link>
        </div>
        <div className="mt-4"><ProductGrid products={promos} /></div>
      </section>
    ) : null,
    collection:
      theme && themeCards.length ? (
        <section key="collection" aria-labelledby="h-tematica" className="mx-auto max-w-7xl px-4">
          <div className="rounded-card bg-brand-lavender/15 p-5 sm:p-8">
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-soft">Temática</p>
            <h2 id="h-tematica" className="mt-1 text-xl font-bold sm:text-2xl">{theme.name}</h2>
            {theme.description ? <p className="mt-1 max-w-2xl text-sm text-ink-soft">{theme.description}</p> : null}
            <p className="mt-3 max-w-2xl text-sm"><strong>Personalización:</strong> {settings.personalizationBlurb}</p>
            <div className="mt-5"><ProductGrid products={themeCards} /></div>
            <ButtonLink href={`/productos?tematica=${theme.slug}`} variant="secondary" className="mt-5">Ver toda la temática</ButtonLink>
          </div>
        </section>
      ) : null,
    how: (
      <section key="how" aria-labelledby="h-como" className="mx-auto max-w-7xl px-4">
        <h2 id="h-como" className="text-xl font-bold sm:text-2xl">Cómo comprar</h2>
        <ol className="mt-4 grid gap-3 sm:grid-cols-3">
          {settings.howToBuy.map((step, i) => (
            <li key={step.title} className="rounded-card border border-line bg-white p-5 shadow-soft">
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-yellow text-sm font-bold">{i + 1}</span>
              <h3 className="mt-3 font-semibold">{step.title}</h3>
              <p className="mt-1 text-sm text-ink-soft">{step.text}</p>
            </li>
          ))}
        </ol>
      </section>
    ),
  };

  const ordered = settings.homeSections.filter((s) => s !== "announcement").map((s) => sections[s]).filter(Boolean);
  return (
    <div className="space-y-10 pb-4 sm:space-y-14">
      {!banner || !settings.homeSections.includes("hero") ? (
        <div className="mx-auto max-w-7xl px-4 pt-6">
          <h1 className="flex items-center gap-2 text-2xl font-bold sm:text-3xl">
            <Star className="h-6 w-6 text-brand-yellow" /> {settings.storeName}
          </h1>
          <p className="text-ink-soft">{settings.tagline}</p>
        </div>
      ) : null}
      {ordered}
    </div>
  );
}
