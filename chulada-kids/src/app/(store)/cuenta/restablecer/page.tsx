import type { Metadata } from "next";
import { ResetForm } from "@/components/store/auth-forms";
import { Alert } from "@/components/ui/alert";

export const metadata: Metadata = { title: "Nueva contraseña", robots: { index: false } };

export default async function ResetPage(props: PageProps<"/cuenta/restablecer">) {
  const sp = await props.searchParams;
  const token = typeof sp.token === "string" ? sp.token : "";
  return (
    <div className="mx-auto max-w-md px-4 py-10">
      <h1 className="text-2xl font-bold">Nueva contraseña</h1>
      <div className="mt-5">{token ? <ResetForm token={token} /> : <Alert tone="error">Falta el enlace de recuperación.</Alert>}</div>
    </div>
  );
}
