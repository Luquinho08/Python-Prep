export default function Loading() {
  return (
    <div className="mx-auto max-w-7xl px-4 py-8" role="status" aria-live="polite">
      <span className="sr-only">Cargando…</span>
      <div className="h-8 w-56 animate-pulse rounded-full bg-surface-soft" />
      <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="aspect-[3/4] animate-pulse rounded-card bg-surface-soft" />
        ))}
      </div>
    </div>
  );
}
