export function promoStatus(p: { isActive: boolean; startsAt: Date | null; endsAt: Date | null }, now = new Date()) {
  if (!p.isActive) return { label: "Inactiva", tone: "neutral" as const };
  if (p.startsAt && p.startsAt > now) return { label: "Programada", tone: "blue" as const };
  if (p.endsAt && p.endsAt <= now) return { label: "Vencida", tone: "neutral" as const };
  return { label: "Vigente", tone: "mint" as const };
}
