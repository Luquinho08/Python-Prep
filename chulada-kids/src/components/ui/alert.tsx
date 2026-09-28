import type { ReactNode } from "react";
import { cn } from "./cn";

type Tone = "info" | "success" | "warning" | "error";
const tones: Record<Tone, string> = {
  info: "bg-brand-blue/15 border-brand-blue",
  success: "bg-brand-mint/50 border-success/50",
  warning: "bg-brand-yellow/40 border-brand-yellow",
  error: "bg-brand-coral/20 border-danger/60",
};

export function Alert({ tone = "info", title, children, className }: { tone?: Tone; title?: ReactNode; children?: ReactNode; className?: string }) {
  return (
    <div role={tone === "error" ? "alert" : "status"} className={cn("rounded-2xl border-l-4 px-4 py-3 text-sm text-ink", tones[tone], className)}>
      {title ? <p className="font-semibold">{title}</p> : null}
      {children ? <div className={title ? "mt-1" : undefined}>{children}</div> : null}
    </div>
  );
}
