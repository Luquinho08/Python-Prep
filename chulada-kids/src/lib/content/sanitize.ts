import sanitizeHtml from "sanitize-html";

/** Lista blanca estricta para contenido editable del CMS. Sin scripts, estilos, iframes ni eventos. */
export function sanitizeRichText(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: ["p", "br", "strong", "b", "em", "i", "u", "ul", "ol", "li", "h2", "h3", "h4", "a", "blockquote"],
    allowedAttributes: { a: ["href", "title"] },
    allowedSchemes: ["http", "https", "mailto", "tel"],
    allowedSchemesAppliedToAttributes: ["href"],
    allowProtocolRelative: false,
    transformTags: {
      a: (tagName, attribs) => ({
        tagName,
        attribs: { ...attribs, rel: "noopener noreferrer nofollow" },
      }),
    },
    disallowedTagsMode: "discard",
  });
}

/** Convierte texto plano con saltos de línea a HTML seguro (para textarea simple del admin). */
export function plainTextToHtml(text: string): string {
  const escaped = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return escaped
    .split(/\n{2,}/)
    .map((p) => `<p>${p.trim().replace(/\n/g, "<br>")}</p>`)
    .filter((p) => p !== "<p></p>")
    .join("");
}

export function htmlToPlainText(html: string): string {
  return sanitizeHtml(html.replace(/<br\s*\/?>(\s*)/gi, "\n").replace(/<\/p>\s*<p>/gi, "\n\n"), {
    allowedTags: [],
    allowedAttributes: {},
  }).trim();
}
