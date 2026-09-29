import type { Metadata } from "next";
import { CatalogView } from "@/components/store/catalog-view";

export const metadata: Metadata = { title: "Productos", alternates: { canonical: "/productos" } };

export default async function ProductsPage(props: PageProps<"/productos">) {
  return <CatalogView title="Todos los productos" basePath="/productos" searchParams={await props.searchParams} />;
}
