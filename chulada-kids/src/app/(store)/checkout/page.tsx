import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { getCartView } from "@/lib/cart/service";
import { getCurrentUser } from "@/lib/auth/session";
import { checkoutReadinessProblems, getStoreSettings } from "@/lib/content/settings";
import { getConnectionInfo, getGateway } from "@/lib/payments/connection";
import { authorizeOrderAccess, orderAccessToken, orderNumber } from "@/lib/orders/access";
import { summaryFromOrder, type CheckoutSummary } from "@/lib/orders/checkout";
import { CheckoutClient } from "@/components/checkout/checkout-client";
import { Alert } from "@/components/ui/alert";
import { ButtonLink } from "@/components/ui/button";

export const metadata: Metadata = { title: "Checkout", robots: { index: false, follow: false } };

export default async function CheckoutPage(props: PageProps<"/checkout">) {
  const sp = await props.searchParams;
  const user = await getCurrentUser();
  const [settings, conn, gw] = await Promise.all([getStoreSettings(), getConnectionInfo(), getGateway()]);
  const problems = checkoutReadinessProblems(settings);
  const payment = {
    driver: (gw?.driver ?? "mercadopago") as "mercadopago" | "fake",
    publicKey: gw?.publicKey ?? null,
    cardEnabled: !!gw && !!gw.publicKey,
    walletEnabled: !!gw,
    environment: conn.environment,
  };

  // Retomar el pago de un pedido existente (p. ej. volviendo de Mercado Pago o tras un rechazo).
  let resume = null;
  const pedido = typeof sp.pedido === "string" ? sp.pedido : null;
  if (pedido) {
    const access = await authorizeOrderAccess(pedido, typeof sp.t === "string" ? sp.t : null);
    if (access && !access.order.supersededBy && ["unpaid", "rejected", "cancelled"].includes(access.order.paymentStatus) && access.order.reservationExpiresAt && access.order.reservationExpiresAt > new Date()) {
      resume = {
        orderId: access.order.id,
        orderNumber: orderNumber(access.order.number),
        accessToken: orderAccessToken(access.order.id),
        summary: await summaryFromOrder(access.order.id),
        reservationExpiresAt: access.order.reservationExpiresAt.toISOString(),
        email: access.order.email,
      };
    } else if (access) {
      redirect(`/checkout/resultado?pedido=${pedido}&t=${encodeURIComponent(orderAccessToken(pedido))}`);
    }
  }

  const view = await getCartView(user?.email ?? null);
  if (!resume && (!view.cart || view.lines.length === 0)) redirect("/carrito");

  const blocked = problems.length > 0 || !gw;
  let prefill = { name: "", email: "", phone: "" };
  if (user) {
    const [u] = await db.select().from(users).where(eq(users.id, user.id));
    prefill = { name: u.name, email: u.email, phone: u.phone ?? "" };
  }
  const initialSummary: CheckoutSummary | null = view.totals
    ? {
        lines: view.lines.map((l) => ({ id: l.id, name: l.productName, variant: l.variantName, quantity: l.quantity, packUnits: l.packUnits, unitLabel: l.unitLabel, personalization: l.personalization.map((p) => ({ label: p.label, display: p.display })), lineTotalCents: l.lineTotalCents, lineRegularCents: l.lineRegularCents })),
        subtotalCents: view.totals.subtotalCents,
        promotionDiscountCents: view.totals.promotionDiscountCents,
        couponDiscountCents: view.totals.couponDiscountCents,
        couponCode: view.totals.coupon?.ok ? view.totals.coupon.code : null,
        couponMessage: view.totals.coupon?.message ?? null,
        shippingCents: 0,
        shippingName: "",
        totalCents: view.totals.totalCents,
        productionDaysMax: Math.max(0, ...view.lines.map((l) => l.productionDaysMax)),
        deliveryDaysMin: 0,
        deliveryDaysMax: 0,
      }
    : resume?.summary ?? null;

  return (
    <div className="mx-auto max-w-7xl px-4 py-6">
      <h1 className="text-2xl font-bold sm:text-3xl">Finalizar compra</h1>
      {payment.driver === "fake" ? (
        <Alert tone="warning" className="mt-3" title="Entorno de desarrollo">Los pagos usan un simulador local. No se procesan tarjetas reales.</Alert>
      ) : conn.environment === "test" ? (
        <Alert tone="warning" className="mt-3" title="Mercado Pago en modo prueba">Los cobros se hacen con credenciales de prueba.</Alert>
      ) : null}
      {blocked && !resume ? (
        <div className="mt-6 space-y-4">
          <Alert tone="warning" title="La compra online todavía no está disponible">
            {[...problems, ...(!gw ? ["Mercado Pago no está conectado: los cobros están bloqueados."] : [])].join(" ")}
          </Alert>
          <ButtonLink href="/contacto" variant="secondary">Consultar por contacto</ButtonLink>
        </div>
      ) : view.hasIssues && !resume ? (
        <Alert tone="error" className="mt-6" title="Revisá tu carrito">
          Hay productos con cambios de disponibilidad o personalización. <Link href="/carrito" className="underline">Volver al carrito</Link>
        </Alert>
      ) : initialSummary ? (
        <div className="mt-6">
          <CheckoutClient initialSummary={initialSummary} prefill={prefill} payment={payment} resume={resume} />
        </div>
      ) : null}
    </div>
  );
}
