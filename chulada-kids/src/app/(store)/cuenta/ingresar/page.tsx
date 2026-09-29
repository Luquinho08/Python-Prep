import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { LoginForm, RegisterForm } from "@/components/store/auth-forms";

export const metadata: Metadata = { title: "Ingresar", robots: { index: false } };

export default async function LoginPage(props: PageProps<"/cuenta/ingresar">) {
  const sp = await props.searchParams;
  const next = typeof sp.next === "string" ? sp.next : undefined;
  if (await getCurrentUser()) redirect(next?.startsWith("/") && !next.startsWith("//") ? next : "/cuenta");
  return (
    <div className="mx-auto grid max-w-4xl gap-8 px-4 py-10 md:grid-cols-2">
      <section aria-labelledby="h-login" className="rounded-card border border-line bg-white p-6 shadow-soft">
        <h1 id="h-login" className="text-2xl font-bold">Ingresar</h1>
        <p className="mt-1 text-sm text-ink-soft">Para ver tus pedidos y direcciones.</p>
        <div className="mt-5"><LoginForm next={next} /></div>
      </section>
      <section aria-labelledby="h-reg" className="rounded-card border border-line bg-surface-soft p-6">
        <h2 id="h-reg" className="text-xl font-bold">Crear cuenta</h2>
        <p className="mt-1 text-sm text-ink-soft">Es opcional: también podés comprar como invitado.</p>
        <div className="mt-5"><RegisterForm next={next} /></div>
      </section>
    </div>
  );
}
