import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUserPage } from "@/lib/auth/guards";
import { getOrderDetail } from "@/lib/orders/queries";
import { orderAccessToken } from "@/lib/orders/access";
import { getStoreSettings } from "@/lib/content/settings";
import { OrderView } from "@/components/store/order-view";

export const metadata: Metadata = { title: "Detalle del pedido", robots: { index: false } };

export default async function AccountOrderPage(props: PageProps<"/cuenta/pedidos/[id]">) {
  const { id } = await props.params;
  const user = await requireUserPage(`/cuenta/pedidos/${id}`);
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const detail = await getOrderDetail(id, { forStaff: false });
  // Un cliente no puede ver pedidos ajenos cambiando el id.
  if (!detail || detail.order.userId !== user.id) notFound();
  const settings = await getStoreSettings();
  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <Link href="/cuenta" className="text-sm underline">← Mis pedidos</Link>
      <div className="mt-3">
        <OrderView detail={detail} token={orderAccessToken(id)} pickupAddress={settings.pickupAddress} />
      </div>
    </div>
  );
}
