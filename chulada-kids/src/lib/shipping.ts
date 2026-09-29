/** Reglas de entrega por código postal. Admite CP de 4 dígitos o CPA ("C1425ABC" → 1425). */
export function normalizePostalCode(input: string): string | null {
  const s = input.trim().toUpperCase();
  const m = /^(?:[A-Z])?(\d{4})(?:[A-Z]{3})?$/.exec(s.replace(/\s/g, ""));
  return m ? m[1] : null;
}

export function postalCodeMatches(rules: string[], cp: string): boolean {
  const n = Number(cp);
  return rules.some((r) => {
    const rule = r.trim();
    const range = /^(\d{4})\s*-\s*(\d{4})$/.exec(rule);
    if (range) return n >= Number(range[1]) && n <= Number(range[2]);
    return rule === cp;
  });
}

export function validPostalRules(rules: string[]): boolean {
  return rules.every((r) => /^\d{4}$/.test(r.trim()) || /^(\d{4})\s*-\s*(\d{4})$/.test(r.trim()));
}
