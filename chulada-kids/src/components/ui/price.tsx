import { formatARS } from "@/lib/money";
import { cn } from "./cn";

export function Price({
  cents,
  regularCents,
  from,
  unitNote,
  size = "md",
  className,
}: {
  cents: number;
  regularCents?: number;
  from?: boolean;
  unitNote?: string;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const discounted = regularCents != null && regularCents > cents;
  const sizes = { sm: "text-base", md: "text-lg", lg: "text-2xl sm:text-3xl" };
  return (
    <div className={cn("flex flex-wrap items-baseline gap-x-2", className)}>
      {from ? <span className="text-xs font-medium text-ink-soft">Desde</span> : null}
      <span className={cn("font-bold text-ink", sizes[size])}>{formatARS(cents)}</span>
      {discounted ? (
        <span className="text-sm text-ink-soft line-through">
          <span className="sr-only">Precio normal: </span>
          {formatARS(regularCents!)}
        </span>
      ) : null}
      {unitNote ? <span className="w-full text-xs text-ink-soft">{unitNote}</span> : null}
    </div>
  );
}
