"use client";
import Link from "next/link";
import { useActionState } from "react";
import {
  acceptInvitationAction,
  loginAction,
  registerAction,
  requestPasswordResetAction,
  resetPasswordAction,
  type AuthState,
} from "@/app/actions/auth";
import { Alert } from "../ui/alert";
import { Button } from "../ui/button";
import { Field, Input } from "../ui/field";

function Msg({ state }: { state: AuthState }) {
  if (!state) return null;
  return <Alert tone={state.ok ? "success" : "error"}>{state.message}</Alert>;
}

export function LoginForm({ next }: { next?: string }) {
  const [state, action, pending] = useActionState(loginAction, null);
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="next" value={next ?? ""} />
      <Field id="login-email" label="Email" required>{(a) => <Input {...a} name="email" type="email" autoComplete="email" />}</Field>
      <Field id="login-pass" label="Contraseña" required>{(a) => <Input {...a} name="password" type="password" autoComplete="current-password" />}</Field>
      <Msg state={state} />
      <Button type="submit" className="w-full" disabled={pending}>{pending ? "Ingresando…" : "Ingresar"}</Button>
      <p className="text-center text-sm">
        <Link className="underline" href="/cuenta/recuperar">Olvidé mi contraseña</Link>
      </p>
    </form>
  );
}

export function RegisterForm({ next }: { next?: string }) {
  const [state, action, pending] = useActionState(registerAction, null);
  const fe = state?.fieldErrors ?? {};
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="next" value={next ?? ""} />
      <Field id="reg-name" label="Nombre" required error={fe.name}>{(a) => <Input {...a} name="name" autoComplete="name" />}</Field>
      <Field id="reg-email" label="Email" required error={fe.email}>{(a) => <Input {...a} name="email" type="email" autoComplete="email" />}</Field>
      <Field id="reg-pass" label="Contraseña" required error={fe.password} hint="Mínimo 10 caracteres.">
        {(a) => <Input {...a} name="password" type="password" autoComplete="new-password" />}
      </Field>
      <Msg state={state && !state.fieldErrors ? state : null} />
      <Button type="submit" className="w-full" variant="secondary" disabled={pending}>{pending ? "Creando…" : "Crear cuenta"}</Button>
    </form>
  );
}

export function ForgotForm() {
  const [state, action, pending] = useActionState(requestPasswordResetAction, null);
  return (
    <form action={action} className="space-y-4">
      <Field id="fg-email" label="Email" required>{(a) => <Input {...a} name="email" type="email" autoComplete="email" />}</Field>
      <Msg state={state} />
      <Button type="submit" className="w-full" disabled={pending}>{pending ? "Enviando…" : "Enviar enlace"}</Button>
    </form>
  );
}

export function ResetForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState(resetPasswordAction, null);
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="token" value={token} />
      <Field id="rs-pass" label="Nueva contraseña" required hint="Mínimo 10 caracteres." error={state?.fieldErrors?.password}>
        {(a) => <Input {...a} name="password" type="password" autoComplete="new-password" />}
      </Field>
      <Msg state={state && !state.fieldErrors ? state : null} />
      <Button type="submit" className="w-full" disabled={pending}>{pending ? "Guardando…" : "Guardar contraseña"}</Button>
    </form>
  );
}

export function InviteForm({ token, email }: { token: string; email: string }) {
  const [state, action, pending] = useActionState(acceptInvitationAction, null);
  const fe = state?.fieldErrors ?? {};
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="token" value={token} />
      <p className="text-sm">Cuenta: <strong>{email}</strong></p>
      <Field id="inv-name" label="Tu nombre" required error={fe.name}>{(a) => <Input {...a} name="name" autoComplete="name" />}</Field>
      <Field id="inv-pass" label="Contraseña" required hint="Mínimo 10 caracteres." error={fe.password}>
        {(a) => <Input {...a} name="password" type="password" autoComplete="new-password" />}
      </Field>
      <Msg state={state && !state.fieldErrors ? state : null} />
      <Button type="submit" className="w-full" disabled={pending}>{pending ? "Activando…" : "Activar acceso"}</Button>
    </form>
  );
}
