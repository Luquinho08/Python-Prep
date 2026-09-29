"use server";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { env } from "@/lib/env";
import { FakeGateway } from "@/lib/payments/fake";
import { db } from "@/lib/db";
import { paymentAttempts } from "@/lib/db/schema";
import { orderAccessToken } from "@/lib/orders/access";

function assertFake() {
  if (env.paymentsDriver !== "fake") throw new Error("Simulador deshabilitado");
}

export async function simulatePreferenceAction(formData: FormData) {
  assertFake();
  const pref = String(formData.get("pref"));
  const outcome = String(formData.get("outcome"));
  if (outcome === "cancel") {
    const [a] = await db.select().from(paymentAttempts).where(eq(paymentAttempts.providerRef, pref));
    redirect(a ? `/checkout/resultado?pedido=${a.orderId}&t=${encodeURIComponent(orderAccessToken(a.orderId))}&intento=${a.id}&collection_status=null` : "/");
  }
  const r = await FakeGateway.payPreference(pref, outcome === "approved" ? "approved" : outcome === "pending" ? "pending" : "rejected");
  const [a] = await db.select().from(paymentAttempts).where(eq(paymentAttempts.id, r.externalReference));
  // Igual que MP, el retorno agrega parámetros que la tienda IGNORA (se consulta el backend).
  redirect(`/checkout/resultado?pedido=${a.orderId}&t=${encodeURIComponent(orderAccessToken(a.orderId))}&intento=${a.id}&collection_status=${outcome}&payment_id=${r.paymentId}`);
}

export async function simulateChallengeAction(formData: FormData) {
  assertFake();
  const order = String(formData.get("order"));
  const ref = await FakeGateway.completeChallenge(order, formData.get("ok") === "1");
  const [a] = await db.select().from(paymentAttempts).where(eq(paymentAttempts.id, ref));
  redirect(`/checkout/resultado?pedido=${a.orderId}&t=${encodeURIComponent(orderAccessToken(a.orderId))}&intento=${a.id}`);
}
