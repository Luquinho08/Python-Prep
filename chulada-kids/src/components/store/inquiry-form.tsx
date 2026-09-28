"use client";
import { useActionState } from "react";
import { sendInquiryAction, type InquiryState } from "@/app/actions/inquiry";
import { Alert } from "../ui/alert";
import { Button } from "../ui/button";
import { Field, Input, Textarea } from "../ui/field";

export function InquiryForm({ kind, productId, defaultMessage = "" }: { kind: "contact" | "quote"; productId?: string; defaultMessage?: string }) {
  const [state, action, pending] = useActionState<InquiryState, FormData>(sendInquiryAction, null);
  if (state?.ok) return <Alert tone="success">{state.message}</Alert>;
  const fe = state?.fieldErrors ?? {};
  return (
    <form action={action} className="space-y-4" noValidate>
      <input type="hidden" name="kind" value={kind} />
      {productId ? <input type="hidden" name="productId" value={productId} /> : null}
      <div className="hidden" aria-hidden="true">
        <label>No completar <input name="website" tabIndex={-1} autoComplete="off" /></label>
      </div>
      <Field id="inq-name" label="Nombre" required error={fe.name}>{(a) => <Input {...a} name="name" autoComplete="name" />}</Field>
      <Field id="inq-email" label="Email" required error={fe.email}>{(a) => <Input {...a} name="email" type="email" autoComplete="email" />}</Field>
      <Field id="inq-phone" label="Teléfono" error={fe.phone}>{(a) => <Input {...a} name="phone" type="tel" autoComplete="tel" />}</Field>
      <Field id="inq-msg" label={kind === "quote" ? "¿Qué necesitás?" : "Mensaje"} required error={fe.message} hint="Piezas, cantidades, fecha del evento y temática.">
        {(a) => <Textarea {...a} name="message" defaultValue={defaultMessage} rows={5} />}
      </Field>
      {state && !state.ok ? <Alert tone="error">{state.message}</Alert> : null}
      <Button type="submit" disabled={pending}>{pending ? "Enviando…" : kind === "quote" ? "Pedir presupuesto" : "Enviar mensaje"}</Button>
    </form>
  );
}
