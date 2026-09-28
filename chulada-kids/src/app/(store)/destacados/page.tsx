import type { Metadata } from "next";
import { CatalogView } from "@/components/store/catalog-view";

export const metadata: Metadata = { title: "Destacados", alternates: { canonical: "/destacados" } };

export default async function FeaturedPage(props: PageProps<"/destacados">) {
  return <CatalogView title="Destacados" description="Productos elegidos por Chulada Kids." basePath="/destacados" searchParams={await props.searchParams} fixed={{ onlyFeatured: true }} />;
}
