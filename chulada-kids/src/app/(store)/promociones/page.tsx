import type { Metadata } from "next";
import { CatalogView } from "@/components/store/catalog-view";

export const metadata: Metadata = { title: "Promociones", alternates: { canonical: "/promociones" } };

export default async function PromotionsPage(props: PageProps<"/promociones">) {
  return (
    <CatalogView
      title="Promociones vigentes"
      description="Precios promocionales con vigencia real. El precio normal se muestra tachado."
      basePath="/promociones"
      searchParams={await props.searchParams}
      fixed={{ onlyPromotions: true }}
    />
  );
}
