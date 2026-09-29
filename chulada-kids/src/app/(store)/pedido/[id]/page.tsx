import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { authorizeOrderAccess, orderAccessToken } from "@/lib/orders/access";
import { getOrderDetail } from "@/lib/orders/queries";
import { getStoreSettings } from "@/lib/content/settings";
import { OrderView } from "@/components/store/order-view";

export const metadata: Metadata = { title: "Tu pedido", robots: { index: false, follow: false } };

/** Acceso de invitado con token de alta entropía (o sesión del dueño). Un id adivinado sin token no alcanza. */
export default async function GuestOrderPage(props: PageProps<"/pedido/[id]">) {
  const { id } = await props.params;
  const sp = await props.searchParams;
  const access = await authorizeOrderAccess(id, typeof sp.t === "string" ? sp.t : null);
  if (!access) notFound();
  const detail = await getOrderDetail(id, { forStaff: false });
  if (!detail) notFound();
  const settings = await getStoreSettings();
  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <OrderView detail={detail} token={access.via === "staff" ? null : orderAccessToken(id)} pickupAddress={settings.pickupAddress} />
    </div>
  );
}
