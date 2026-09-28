import Image from "next/image";
import Link from "next/link";
import { Star } from "../ui/decor";

/**
 * Si el propietario cargó el logo real (Admin → Configuración) se usa esa imagen respetando proporciones.
 * Si no, se muestra una marca tipográfica provisional (el lettering del logo no se reconstruye con una fuente).
 */
export function Logo({ logoUrl, logoWidth, logoHeight, storeName }: { logoUrl?: string | null; logoWidth?: number | null; logoHeight?: number | null; storeName: string }) {
  return (
    <Link href="/" className="flex shrink-0 items-center gap-1.5 rounded-lg" aria-label={`${storeName}, ir al inicio`}>
      {logoUrl && logoWidth && logoHeight ? (
        <Image src={logoUrl} alt="" width={logoWidth} height={logoHeight} priority className="h-10 w-auto sm:h-12" sizes="160px" />
      ) : (
        <>
          <Star className="h-6 w-6 text-brand-yellow" />
          <span className="text-lg font-bold tracking-tight sm:text-xl">
            Chulada <span className="text-blue-strong">Kids</span>
          </span>
        </>
      )}
    </Link>
  );
}
