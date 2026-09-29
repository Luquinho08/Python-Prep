import type { Metadata } from "next";
import { Footer } from "@/components/store/footer";
import { Header } from "@/components/store/header";
import { getStoreSettings } from "@/lib/content/settings";

export async function generateMetadata(): Promise<Metadata> {
  const s = await getStoreSettings();
  // Mientras la tienda sea demostración (o el propietario lo pida) no se indexa.
  return s.noindexSite ? { robots: { index: false, follow: false } } : {};
}

export default function StoreLayout({ children }: LayoutProps<"/">) {
  return (
    <>
      <Header />
      <main id="contenido" className="flex-1">
        {children}
      </main>
      <Footer />
    </>
  );
}
