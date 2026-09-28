import type { ReactNode } from "react";
import { cn } from "./cn";

type Tone = "blue" | "mint" | "lavender" | "yellow" | "coral" | "neutral";
const tones: Record<Tone, string> = {
  blue: "bg-brand-blue/30",
  mint: "bg-brand-mint",
  lavender: "bg-brand-lavender/35",
  yellow: "bg-brand-yellow",
  coral: "bg-brand-coral/60",
  neutral: "bg-ink/8",
};

export function Badge({ tone = "neutral", children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return <span className={cn("inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold text-ink", tones[tone], className)}>{children}</span>;
}
