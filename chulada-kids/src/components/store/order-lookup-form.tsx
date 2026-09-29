"use client";
import { useActionState } from "react";
import { orderLookupAction } from "@/app/actions/order-lookup";
import { Alert } from "../ui/alert";
import { Button } from "../ui/button";
import { Field, Input } from "../ui/field";

export function OrderLookupForm() {
  const [state, action, pending] = useActionState(orderLookupAction, null);
  return (
    <form action={action} className="space-y-4">
      <Field id="lk-num" label="Número de pedido" required hint="Ejemplo: CK-000123">
        {(a) => <Input {...a} name="number" autoComplete="off" />}
      </Field>
      <Field id="lk-email" label="Email de la compra" required>
        {(a) => <Input {...a} name="email" type="email" autoComplete="email" />}
      </Field>
      {state ? <Alert tone={state.ok ? "success" : "error"}>{state.message}</Alert> : null}
      <Button type="submit" disabled={pending}>{pending ? "Enviando…" : "Enviarme el enlace"}</Button>
    </form>
  );
}
