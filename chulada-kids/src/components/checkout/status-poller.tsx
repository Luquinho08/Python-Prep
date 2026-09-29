"use client";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Refresca la página de resultado mientras el pago esté en proceso (máx. ~5 minutos). */
export function StatusPoller({ active }: { active: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    let n = 0;
    const id = setInterval(() => {
      if (++n > 60) return clearInterval(id);
      router.refresh();
    }, 5000);
    return () => clearInterval(id);
  }, [active, router]);
  return null;
}

export function ClearCheckoutStorage({ orderId }: { orderId: string }) {
  useEffect(() => {
    try {
      sessionStorage.removeItem(`ck_pay_key_${orderId}`);
    } catch {
      /* nada */
    }
  }, [orderId]);
  return null;
}
