import { requirePagePermission } from "@/lib/auth/guards";
import { TaxonomyPage } from "@/components/admin/taxonomy-page";

export default async function Page(props: PageProps<"/admin/categorias">) {
  await requirePagePermission("catalog:write");
  return <TaxonomyPage kind="category" sp={await props.searchParams} />;
}
