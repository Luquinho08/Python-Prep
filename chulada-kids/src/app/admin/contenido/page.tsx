import Image from "next/image";
import { asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { banners, faqs, media, pages, themes } from "@/lib/db/schema";
import { requirePagePermission } from "@/lib/auth/guards";
import { getStoreSettings, HOME_SECTIONS, HOME_SECTION_LABELS } from "@/lib/content/settings";
import { htmlToPlainText } from "@/lib/content/sanitize";
import { publicMediaUrl } from "@/lib/storage";
import { Card, FlashFromParams, PageHeader } from "@/components/admin/ui";
import { inputClasses } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { buttonClasses } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { deleteBannerAction, deleteFaqAction, saveBannerAction, saveFaqAction, saveHomeAction, savePageAction } from "./actions";

export default async function ContentAdmin(props: PageProps<"/admin/contenido">) {
  await requirePagePermission("content:write");
  const [s, bannerRows, faqRows, pageRows, themeRows] = await Promise.all([
    getStoreSettings(),
    db.select({ b: banners, key: media.storageKey }).from(banners).leftJoin(media, eq(media.id, banners.imageId)).orderBy(asc(banners.sort)),
    db.select().from(faqs).orderBy(asc(faqs.sort)),
    db.select().from(pages).orderBy(asc(pages.title)),
    db.select().from(themes).orderBy(asc(themes.sort)),
  ]);
  return (
    <div className="space-y-6">
      <PageHeader title="Contenido" description="Texto simple: no se aceptan scripts ni HTML arbitrario. Las secciones vacías se ocultan solas." />
      <FlashFromParams sp={await props.searchParams} />

      <Card title="Inicio: secciones y textos">
        <form action={saveHomeAction} className="space-y-4">
          <fieldset>
            <legend className="text-sm font-medium">Secciones (activá y numerá el orden)</legend>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {HOME_SECTIONS.map((sec) => {
                const pos = s.homeSections.indexOf(sec);
                return (
                  <div key={sec} className="flex items-center gap-2 rounded-xl border border-line px-3 py-2 text-sm">
                    <input type="checkbox" id={`on-${sec}`} name={`on_${sec}`} defaultChecked={pos >= 0} />
                    <label htmlFor={`on-${sec}`} className="flex-1">{HOME_SECTION_LABELS[sec]}</label>
                    <label className="sr-only" htmlFor={`pos-${sec}`}>Posición de {HOME_SECTION_LABELS[sec]}</label>
                    <input id={`pos-${sec}`} name={`pos_${sec}`} type="number" defaultValue={pos >= 0 ? pos + 1 : 9} className="w-16 rounded-lg border-2 border-line px-2 py-1" />
                  </div>
                );
              })}
            </div>
          </fieldset>
          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <label className="text-sm" htmlFor="ann">Franja informativa (mensaje real, sin beneficios inventados)</label>
              <input id="ann" name="announcementText" defaultValue={s.announcementText} maxLength={160} className={inputClasses} />
              <label className="mt-1 flex items-center gap-2 text-sm"><input type="checkbox" name="announcementEnabled" defaultChecked={s.announcementEnabled} /> Mostrar</label>
            </div>
            <div>
              <label className="text-sm" htmlFor="fth">Temática destacada en el inicio</label>
              <select id="fth" name="featuredThemeId" defaultValue={s.featuredThemeId ?? ""} className={inputClasses}>
                <option value="">Ninguna</option>
                {themeRows.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
            <div className="md:col-span-2"><label className="text-sm" htmlFor="blurb">Explicación de personalización</label><textarea id="blurb" name="personalizationBlurb" defaultValue={s.personalizationBlurb} rows={2} className={inputClasses} /></div>
            {s.howToBuy.map((h, i) => (
              <div key={i} className="grid gap-2 md:col-span-2 md:grid-cols-[1fr_2fr]">
                <div><label className="text-xs" htmlFor={`ht-${i}`}>Paso {i + 1}: título</label><input id={`ht-${i}`} name={`how_t_${i}`} defaultValue={h.title} className={inputClasses} /></div>
                <div><label className="text-xs" htmlFor={`hd-${i}`}>Paso {i + 1}: texto</label><input id={`hd-${i}`} name={`how_d_${i}`} defaultValue={h.text} className={inputClasses} /></div>
              </div>
            ))}
          </div>
          <SubmitButton>Guardar inicio</SubmitButton>
        </form>
      </Card>

      <Card title="Banners">
        {[...bannerRows, null].map((row) => {
          const b = row?.b;
          const k = b?.id ?? "new";
          return (
            <div key={k} className="mb-4 rounded-2xl border border-line p-3">
              {!b ? <p className="mb-2 text-sm font-semibold">Nuevo banner</p> : null}
              <form action={saveBannerAction} className="grid gap-2 md:grid-cols-4">
                {b ? <input type="hidden" name="id" value={b.id} /> : null}
                <div className="md:col-span-2"><label className="text-xs" htmlFor={`bt-${k}`}>Título</label><input id={`bt-${k}`} name="title" defaultValue={b?.title} required className={inputClasses} /></div>
                <div className="md:col-span-2"><label className="text-xs" htmlFor={`bs-${k}`}>Subtítulo</label><input id={`bs-${k}`} name="subtitle" defaultValue={b?.subtitle} className={inputClasses} /></div>
                <div><label className="text-xs" htmlFor={`bl-${k}`}>Texto del botón</label><input id={`bl-${k}`} name="ctaLabel" defaultValue={b?.ctaLabel ?? "Ver productos"} className={inputClasses} /></div>
                <div><label className="text-xs" htmlFor={`bh-${k}`}>Enlace interno</label><input id={`bh-${k}`} name="ctaHref" defaultValue={b?.ctaHref ?? "/productos"} className={inputClasses} /></div>
                <div><label className="text-xs" htmlFor={`bo-${k}`}>Orden</label><input id={`bo-${k}`} name="sort" type="number" defaultValue={b?.sort ?? 0} className={inputClasses} /></div>
                <div className="flex items-end gap-3"><label className="flex items-center gap-2 pb-3 text-sm"><input type="checkbox" name="isActive" defaultChecked={b ? b.isActive : true} /> Activo</label><SubmitButton size="sm">Guardar</SubmitButton></div>
              </form>
              {b ? (
                <div className="mt-3 flex flex-wrap items-end gap-3">
                  {row?.key ? <Image src={publicMediaUrl(row.key) ?? ""} alt="" width={160} height={70} className="h-16 w-auto rounded-lg object-cover" /> : <Badge tone="yellow">Sin imagen</Badge>}
                  <form action="/api/admin/upload" method="post" encType="multipart/form-data" className="flex flex-wrap items-end gap-2">
                    <input type="hidden" name="target" value="banner" /><input type="hidden" name="id" value={b.id} /><input type="hidden" name="back" value="/admin/contenido" />
                    <label className="text-xs" htmlFor={`bi-${k}`}>Imagen</label>
                    <input id={`bi-${k}`} name="file" type="file" accept="image/jpeg,image/png,image/webp" className="text-sm" />
                    <input name="alt" placeholder="Texto alternativo" aria-label="Texto alternativo" className="rounded-lg border-2 border-line px-2 py-1 text-sm" />
                    <button className={buttonClasses("secondary", "sm")}>Subir imagen</button>
                  </form>
                  <form action={deleteBannerAction}><input type="hidden" name="id" value={b.id} /><button className="text-xs text-danger underline">Eliminar banner</button></form>
                </div>
              ) : null}
            </div>
          );
        })}
      </Card>

      <Card title="Preguntas frecuentes">
        {[...faqRows, null].map((f) => (
          <form key={f?.id ?? "new"} action={saveFaqAction} className="mb-3 grid gap-2 rounded-2xl border border-line p-3 md:grid-cols-[1fr_2fr_80px_auto]">
            {f ? <input type="hidden" name="id" value={f.id} /> : null}
            <div><label className="text-xs" htmlFor={`fq-${f?.id ?? "n"}`}>Pregunta</label><input id={`fq-${f?.id ?? "n"}`} name="question" defaultValue={f?.question} className={inputClasses} /></div>
            <div><label className="text-xs" htmlFor={`fa-${f?.id ?? "n"}`}>Respuesta</label><textarea id={`fa-${f?.id ?? "n"}`} name="answer" rows={2} defaultValue={f ? htmlToPlainText(f.answerHtml) : ""} className={inputClasses} /></div>
            <div><label className="text-xs" htmlFor={`fo-${f?.id ?? "n"}`}>Orden</label><input id={`fo-${f?.id ?? "n"}`} name="sort" type="number" defaultValue={f?.sort ?? faqRows.length + 1} className={inputClasses} /></div>
            <div className="flex flex-col justify-end gap-1">
              <label className="flex items-center gap-1 text-xs"><input type="checkbox" name="isActive" defaultChecked={f ? f.isActive : true} /> Visible</label>
              <SubmitButton size="sm">{f ? "Guardar" : "Agregar"}</SubmitButton>
            </div>
          </form>
        ))}
        {faqRows.map((f) => (
          <form key={`d-${f.id}`} action={deleteFaqAction} className="inline"><input type="hidden" name="id" value={f.id} /><button className="mr-3 text-xs text-danger underline">Eliminar “{f.question.slice(0, 30)}”</button></form>
        ))}
      </Card>

      <Card title="Páginas y políticas">
        <p className="mb-3 text-sm text-ink-soft">Las marcadas como “pendientes” muestran un aviso al público. No se inventan domicilio, datos fiscales ni condiciones legales: el propietario debe redactarlas.</p>
        {[...pageRows, null].map((p) => (
          <form key={p?.slug ?? "new"} action={savePageAction} className="mb-4 space-y-2 rounded-2xl border border-line p-3">
            <div className="grid gap-2 md:grid-cols-2">
              <div><label className="text-xs" htmlFor={`pt-${p?.slug ?? "n"}`}>Título</label><input id={`pt-${p?.slug ?? "n"}`} name="title" defaultValue={p?.title} className={inputClasses} /></div>
              <div><label className="text-xs" htmlFor={`ps-${p?.slug ?? "n"}`}>Slug</label><input id={`ps-${p?.slug ?? "n"}`} name="slug" defaultValue={p?.slug} readOnly={!!p} className={inputClasses} /></div>
            </div>
            <label className="text-xs" htmlFor={`pb-${p?.slug ?? "n"}`}>Contenido</label>
            <textarea id={`pb-${p?.slug ?? "n"}`} name="body" rows={4} defaultValue={p ? htmlToPlainText(p.bodyHtml) : ""} className={inputClasses} />
            <div className="flex flex-wrap items-center gap-4 text-sm">
              <label className="flex items-center gap-2"><input type="checkbox" name="isPending" defaultChecked={p ? p.isPending : true} /> Contenido pendiente</label>
              <label className="flex items-center gap-2"><input type="checkbox" name="showInFooter" defaultChecked={p ? p.showInFooter : true} /> Mostrar en el pie</label>
              <SubmitButton size="sm">{p ? "Guardar" : "Crear página"}</SubmitButton>
            </div>
          </form>
        ))}
      </Card>
    </div>
  );
}
