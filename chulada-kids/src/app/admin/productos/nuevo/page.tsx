import { requirePagePermission } from "@/lib/auth/guards";
import { FlashFromParams, PageHeader } from "@/components/admin/ui";
import { ProductForm } from "@/components/admin/product-form";

export default async function NewProductPage(props: PageProps<"/admin/productos/nuevo">) {
  await requirePagePermission("catalog:write");
  return (
    <div>
      <PageHeader title="Nuevo producto" description="Se crea como borrador con una variante “Única”. Después cargá imágenes, variantes y personalización, y publicalo." />
      <FlashFromParams sp={await props.searchParams} />
      <ProductForm />
    </div>
  );
}
