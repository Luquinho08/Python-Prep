import type { ReactNode } from "react";
import { Alert } from "../ui/alert";

export function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-bold">{title}</h1>
        {description ? <p className="mt-1 text-sm text-ink-soft">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}

export function Card({ title, children, className = "" }: { title?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-card border border-line bg-white p-4 sm:p-5 ${className}`}>
      {title ? <h2 className="mb-3 text-lg font-semibold">{title}</h2> : null}
      {children}
    </section>
  );
}

/** Mensajes de resultado que llegan por la URL (?ok= / ?error=) tras una server action. */
export function FlashFromParams({ sp }: { sp: Record<string, string | string[] | undefined> }) {
  const ok = typeof sp.ok === "string" ? sp.ok.slice(0, 300) : null;
  const error = typeof sp.error === "string" ? sp.error.slice(0, 500) : null;
  if (!ok && !error) return null;
  return <Alert tone={error ? "error" : "success"} className="mb-4">{error ?? ok}</Alert>;
}

export function Table({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-card border border-line bg-white">
      <table className="w-full min-w-[640px] text-left text-sm [&_td]:px-3 [&_td]:py-2.5 [&_th]:px-3 [&_th]:py-2.5 [&_th]:font-semibold [&_thead]:bg-surface-soft [&_tr]:border-b [&_tr]:border-line">
        {children}
      </table>
    </div>
  );
}
