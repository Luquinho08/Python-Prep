"use client";
import Image from "next/image";
import { useRef, useState } from "react";

type Img = { id: string; url: string; alt: string; width: number; height: number; isPlaceholder: boolean };

export function Gallery({ images, name }: { images: Img[]; name: string }) {
  const [active, setActive] = useState(0);
  const dialogRef = useRef<HTMLDialogElement>(null);
  if (images.length === 0) {
    return <div className="flex aspect-square items-center justify-center rounded-card bg-surface-soft text-sm text-ink-soft">Sin imágenes</div>;
  }
  const img = images[active];
  return (
    <div>
      <button
        type="button"
        onClick={() => dialogRef.current?.showModal()}
        className="relative block aspect-square w-full overflow-hidden rounded-card bg-surface-soft"
        aria-label={`Ampliar imagen: ${img.alt}`}
      >
        <Image src={img.url} alt={img.alt} fill priority sizes="(min-width: 1024px) 560px, 100vw" className="object-cover" />
        <span className="absolute bottom-3 right-3 rounded-full bg-white/90 px-3 py-1 text-xs font-semibold shadow-sm">Ampliar</span>
      </button>
      {images.length > 1 ? (
        <ul className="mt-3 flex gap-2 overflow-x-auto pb-1" aria-label="Miniaturas">
          {images.map((im, i) => (
            <li key={im.id} className="shrink-0">
              <button
                type="button"
                onClick={() => setActive(i)}
                aria-label={`Ver imagen ${i + 1} de ${images.length}`}
                aria-current={i === active}
                className={`relative block h-16 w-16 overflow-hidden rounded-xl border-2 sm:h-20 sm:w-20 ${i === active ? "border-blue-strong" : "border-line"}`}
              >
                <Image src={im.url} alt="" fill sizes="80px" className="object-cover" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <dialog
        ref={dialogRef}
        aria-label={`Imagen ampliada de ${name}`}
        className="m-auto max-h-[92vh] w-[min(92vw,900px)] rounded-card p-0 backdrop:bg-ink/60"
        onClick={(e) => {
          if (e.target === dialogRef.current) dialogRef.current?.close();
        }}
      >
        <div className="relative">
          <Image src={img.url} alt={img.alt} width={img.width} height={img.height} sizes="900px" className="h-auto max-h-[85vh] w-full object-contain" />
          <form method="dialog" className="absolute right-2 top-2">
            <button className="rounded-full bg-white px-4 py-2 text-sm font-semibold shadow" autoFocus>
              Cerrar
            </button>
          </form>
        </div>
      </dialog>
    </div>
  );
}
