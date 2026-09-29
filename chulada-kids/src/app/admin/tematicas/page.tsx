import { requirePagePermission } from "@/lib/auth/guards";
import { TaxonomyPage } from "@/components/admin/taxonomy-page";

export default async function Page(props: PageProps<"/admin/tematicas">) {
  await requirePagePermission("catalog:write");
  return <TaxonomyPage kind="theme" sp={await props.searchParams} />;
}
