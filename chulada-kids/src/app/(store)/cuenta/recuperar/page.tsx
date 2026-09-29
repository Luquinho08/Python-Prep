import type { Metadata } from "next";
import { ForgotForm } from "@/components/store/auth-forms";

export const metadata: Metadata = { title: "Recuperar contraseña", robots: { index: false } };

export default function ForgotPage() {
  return (
    <div className="mx-auto max-w-md px-4 py-10">
      <h1 className="text-2xl font-bold">Recuperar contraseña</h1>
      <p className="mt-1 text-sm text-ink-soft">Te enviamos un enlace de un solo uso para crear una nueva.</p>
      <div className="mt-5"><ForgotForm /></div>
    </div>
  );
}
