import type { ReactNode } from "react";
import { Star } from "./decor";

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center rounded-card border-2 border-dashed border-line bg-surface-soft px-6 py-12 text-center">
      <Star className="h-10 w-10 text-brand-yellow" />
      <h2 className="mt-3 text-lg font-semibold">{title}</h2>
      {children ? <div className="mt-1 max-w-md text-sm text-ink-soft">{children}</div> : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}
