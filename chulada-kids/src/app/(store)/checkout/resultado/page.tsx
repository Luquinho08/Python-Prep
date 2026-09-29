import type { Metadata } from "next";
import Link from "next/link";
import { authorizeOrderAccess, orderAccessToken, orderNumber } from "@/lib/orders/access";
import { refreshOrderPayment } from "@/lib/payments/service";
import { db } from "@/lib/db";
import { orders } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { formatARS } from "@/lib/money";
import { Alert } from "@/components/ui/alert";
import { ButtonLink } from "@/components/ui/button";
import { ClearCheckoutStorage, StatusPoller } from "@/components/checkout/status-poller";
import { Rainbow } from "@/components/ui/decor";

export const metadata: Metadata = { title: "Estado del pago", robots: { index: false, follow: false } };

/**
 * Resultado honesto: SIEMPRE consulta el backend (que concilia con el proveedor).
 * Los parámetros que agrega Mercado Pago al volver (collection_status, etc.) se ignoran.
 */
export default async function ResultPage(props: PageProps<"/checkout/resultado">) {
  const sp = await props.searchParams;
  const orderId = typeof sp.pedido === "string" ? sp.pedido : "";
  const access = await authorizeOrderAccess(orderId, typeof sp.t === "string" ? sp.t : null);
  if (!access) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-10">
        <Alert tone="error" title="No encontramos el pedido">Revisá el enlace del email de confirmación o ingresá a tu cuenta.</Alert>
      </div>
    );
  }
  await refreshOrderPayment(orderId).catch(() => null);
  const [o] = await db.select().from(orders).where(eq(orders.id, orderId));
  const number = orderNumber(o.number);
  const token = orderAccessToken(o.id);
  const retryHref = `/checkout?pedido=${o.id}&t=${encodeURIComponent(token)}`;
  const orderHref = `/pedido/${o.id}?t=${encodeURIComponent(token)}`;
  const inProcess = ["pending", "requires_action", "to_verify"].includes(o.paymentStatus);
  const canRetry = !o.supersededBy && o.reservationExpiresAt && o.reservationExpiresAt > new Date();

  let body: React.ReactNode;
  switch (o.paymentStatus) {
    case "approved":
    case "partially_refunded":
      body = (
        <>
          <Rainbow className="h-10 w-16" />
          <h1 className="mt-2 text-2xl font-bold">¡Gracias! Pago aprobado</h1>
          <p className="mt-2">Mercado Pago confirmó el pago de tu pedido <strong>{number}</strong> por {formatARS(o.totalCents)}.</p>
          <p className="mt-1 text-sm text-ink-soft">Te enviamos un email a {o.email} con el detalle y el enlace de seguimiento.</p>
          <ButtonLink href={orderHref} className="mt-5">Ver mi pedido</ButtonLink>
          <ClearCheckoutStorage orderId={o.id} />
        </>
      );
      break;
    case "pending":
    case "to_verify":
    case "requires_action":
      body = (
        <>
          <h1 className="text-2xl font-bold">{o.paymentStatus === "to_verify" ? "Estamos verificando tu pago" : o.paymentStatus === "requires_action" ? "Falta la verificación de tu banco" : "Tu pago está en proceso"}</h1>
          <p className="mt-2">Pedido <strong>{number}</strong>. Esta página se actualiza sola. {o.paymentStatus === "to_verify" ? "No vuelvas a pagar mientras verificamos: evitamos cobros duplicados." : "Te avisamos por email cuando Mercado Pago lo confirme."}</p>
          <p className="mt-1 text-sm text-ink-soft">Mantenemos la reserva de tus productos mientras el pago esté pendiente.</p>
          <ButtonLink href={orderHref} variant="secondary" className="mt-5">Ver mi pedido</ButtonLink>
          <StatusPoller active />
        </>
      );
      break;
    case "rejected":
      body = (
        <>
          <h1 className="text-2xl font-bold">El pago no se aprobó</h1>
          <p className="mt-2">No se realizó ningún cobro por el pedido <strong>{number}</strong>. Podés intentar con otra tarjeta o con tu cuenta de Mercado Pago.</p>
          {canRetry ? <ButtonLink href={retryHref} className="mt-5">Reintentar el pago</ButtonLink> : <ButtonLink href="/carrito" className="mt-5">Volver al carrito</ButtonLink>}
        </>
      );
      break;
    case "refunded":
      body = <h1 className="text-2xl font-bold">Este pedido fue reembolsado</h1>;
      break;
    case "expired":
      body = (
        <>
          <h1 className="text-2xl font-bold">La reserva venció</h1>
          <p className="mt-2">El pedido {number} no se pagó a tiempo y liberamos los productos. Podés volver a armarlo.</p>
          <ButtonLink href="/carrito" className="mt-5">Ir al carrito</ButtonLink>
        </>
      );
      break;
    default:
      body = (
        <>
          <h1 className="text-2xl font-bold">Todavía no registramos un pago</h1>
          <p className="mt-2">Si cancelaste en Mercado Pago o cerraste la ventana, tu pedido <strong>{number}</strong> sigue esperando el pago.</p>
          {canRetry ? <ButtonLink href={retryHref} className="mt-5">Elegir cómo pagar</ButtonLink> : <ButtonLink href="/carrito" className="mt-5">Volver al carrito</ButtonLink>}
        </>
      );
  }
  return (
    <div className="mx-auto max-w-2xl px-4 py-10">
      <div className="rounded-card border border-line bg-white p-6 shadow-soft" aria-live="polite">{body}</div>
      {inProcess ? null : <p className="mt-4 text-center text-sm"><Link className="underline" href="/productos">Seguir mirando productos</Link></p>}
    </div>
  );
}
