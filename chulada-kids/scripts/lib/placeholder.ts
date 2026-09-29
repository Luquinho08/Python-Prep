/**
 * Genera ilustraciones placeholder propias (SVG → WEBP) claramente rotuladas como demostración.
 * No usan fotos ni marcas de terceros.
 */
export const PALETTE = {
  blue: "#6EA8DF",
  mint: "#B1E9E6",
  lavender: "#A790E2",
  yellow: "#FED669",
  coral: "#FC938E",
  ink: "#303044",
};

export type Motif = "labels" | "stickers" | "cards" | "invite" | "envelope" | "box" | "topper" | "kit" | "banner" | "category";

function esc(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function star(cx: number, cy: number, r: number, fill: string) {
  const pts: string[] = [];
  for (let i = 0; i < 10; i++) {
    const rad = (Math.PI / 5) * i - Math.PI / 2;
    const rr = i % 2 === 0 ? r : r * 0.45;
    pts.push(`${(cx + rr * Math.cos(rad)).toFixed(1)},${(cy + rr * Math.sin(rad)).toFixed(1)}`);
  }
  return `<polygon points="${pts.join(" ")}" fill="${fill}"/>`;
}

function rainbow(cx: number, cy: number, r: number) {
  const colors = [PALETTE.coral, PALETTE.yellow, PALETTE.mint, PALETTE.blue, PALETTE.lavender];
  return colors
    .map((c, i) => {
      const rr = r - i * (r / 7);
      return `<path d="M ${cx - rr} ${cy} A ${rr} ${rr} 0 0 1 ${cx + rr} ${cy}" stroke="${c}" stroke-width="${r / 8}" fill="none" stroke-linecap="round"/>`;
    })
    .join("");
}

function motifShapes(motif: Motif, accent: string, w: number, h: number): string {
  const cx = w / 2;
  const cy = h / 2 - 30;
  switch (motif) {
    case "labels":
      return [0, 1, 2]
        .map(
          (i) =>
            `<rect x="${cx - 190 + i * 20}" y="${cy - 110 + i * 70}" width="340" height="90" rx="45" fill="#fff" stroke="${accent}" stroke-width="6"/>` +
            `<rect x="${cx - 160 + i * 20}" y="${cy - 80 + i * 70}" width="${180 - i * 30}" height="18" rx="9" fill="${PALETTE.ink}" opacity=".25"/>`,
        )
        .join("");
    case "stickers":
      return (
        `<circle cx="${cx - 110}" cy="${cy - 40}" r="85" fill="#fff" stroke="${accent}" stroke-width="6"/>` +
        rainbow(cx - 110, cy - 20, 60) +
        `<circle cx="${cx + 100}" cy="${cy + 30}" r="95" fill="#fff" stroke="${PALETTE.lavender}" stroke-width="6"/>` +
        star(cx + 100, cy + 30, 55, PALETTE.yellow)
      );
    case "cards":
      return (
        `<rect x="${cx - 200}" y="${cy - 150}" width="260" height="330" rx="18" fill="#fff" stroke="${PALETTE.ink}" stroke-opacity=".15" stroke-width="3" transform="rotate(-6 ${cx} ${cy})"/>` +
        `<rect x="${cx - 60}" y="${cy - 140}" width="260" height="330" rx="18" fill="#fff" stroke="${accent}" stroke-width="6" transform="rotate(5 ${cx} ${cy})"/>` +
        star(cx + 70, cy - 20, 60, accent)
      );
    case "invite":
      return (
        `<rect x="${cx - 150}" y="${cy - 170}" width="300" height="380" rx="20" fill="#fff" stroke="${accent}" stroke-width="6"/>` +
        rainbow(cx, cy - 30, 110) +
        `<rect x="${cx - 100}" y="${cy + 30}" width="200" height="22" rx="11" fill="${PALETTE.ink}" opacity=".3"/>` +
        `<rect x="${cx - 70}" y="${cy + 70}" width="140" height="16" rx="8" fill="${PALETTE.ink}" opacity=".2"/>`
      );
    case "envelope":
      return (
        `<rect x="${cx - 210}" y="${cy - 120}" width="420" height="270" rx="16" fill="${accent}"/>` +
        `<path d="M ${cx - 210} ${cy - 110} L ${cx} ${cy + 40} L ${cx + 210} ${cy - 110}" fill="none" stroke="#fff" stroke-width="8" stroke-linejoin="round"/>` +
        star(cx, cy + 90, 30, "#fff")
      );
    case "box":
      return (
        `<rect x="${cx - 170}" y="${cy - 60}" width="340" height="230" rx="14" fill="${accent}"/>` +
        `<rect x="${cx - 190}" y="${cy - 110}" width="380" height="70" rx="14" fill="#fff" stroke="${accent}" stroke-width="6"/>` +
        `<rect x="${cx - 22}" y="${cy - 110}" width="44" height="280" fill="${PALETTE.yellow}"/>` +
        star(cx, cy - 140, 38, PALETTE.coral)
      );
    case "topper":
      return (
        `<line x1="${cx - 90}" y1="${cy + 40}" x2="${cx - 90}" y2="${cy + 200}" stroke="${PALETTE.ink}" stroke-opacity=".35" stroke-width="8" stroke-linecap="round"/>` +
        `<line x1="${cx + 90}" y1="${cy + 40}" x2="${cx + 90}" y2="${cy + 200}" stroke="${PALETTE.ink}" stroke-opacity=".35" stroke-width="8" stroke-linecap="round"/>` +
        rainbow(cx, cy + 40, 170) +
        star(cx, cy - 80, 50, PALETTE.yellow)
      );
    case "kit":
      return (
        `<rect x="${cx - 230}" y="${cy - 40}" width="190" height="210" rx="16" fill="${accent}"/>` +
        `<rect x="${cx - 20}" y="${cy - 130}" width="160" height="220" rx="16" fill="#fff" stroke="${PALETTE.lavender}" stroke-width="6"/>` +
        `<circle cx="${cx + 170}" cy="${cy + 110}" r="70" fill="#fff" stroke="${PALETTE.coral}" stroke-width="6"/>` +
        star(cx + 170, cy + 110, 40, PALETTE.yellow) +
        star(cx + 60, cy - 30, 45, PALETTE.blue)
      );
    case "banner":
      return rainbow(w * 0.78, h * 0.75, 260) + star(w * 0.62, h * 0.28, 40, PALETTE.yellow) + star(w * 0.9, h * 0.22, 26, PALETTE.lavender);
    case "category":
      return star(cx, cy, 120, accent) + star(cx + 150, cy - 90, 34, PALETTE.yellow);
  }
}

export function placeholderSvg(opts: { title: string; motif: Motif; accent?: keyof typeof PALETTE; bg?: keyof typeof PALETTE; w?: number; h?: number }) {
  const w = opts.w ?? 1000;
  const h = opts.h ?? 1000;
  const accent = PALETTE[opts.accent ?? "blue"];
  const bg = PALETTE[opts.bg ?? "mint"];
  const title = esc(opts.title);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <rect width="${w}" height="${h}" fill="#ffffff"/>
  <rect x="24" y="24" width="${w - 48}" height="${h - 48}" rx="40" fill="${bg}" opacity=".45"/>
  ${motifShapes(opts.motif, accent, w, h)}
  <text x="${w / 2}" y="${h - 120}" text-anchor="middle" font-family="Poppins, Arial, sans-serif" font-size="${Math.round(w / 22)}" font-weight="600" fill="${PALETTE.ink}">${title}</text>
  <rect x="${w / 2 - 190}" y="${h - 90}" width="380" height="44" rx="22" fill="${PALETTE.ink}"/>
  <text x="${w / 2}" y="${h - 60}" text-anchor="middle" font-family="Arial, sans-serif" font-size="20" font-weight="700" fill="#ffffff" letter-spacing="2">IMAGEN DE DEMOSTRACIÓN</text>
</svg>`;
}

export type PaletteColor = keyof typeof PALETTE;
