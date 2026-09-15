import type { Metadata } from "next";
import { Footer } from "@/components/Footer";
import { Header } from "@/components/Header";
import { AuthSessionProvider } from "@/components/auth/AuthSessionProvider";
import { OwnerPropertyProvider } from "@/components/owner/OwnerPropertyProvider";
import { Toaster } from "sonner";
import { fetchDefaultSeoMetadata } from "@/lib/site-settings.server";
import { iranYekan } from "./fonts";
import "maplibre-gl/dist/maplibre-gl.css";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const seo = await fetchDefaultSeoMetadata();

  return {
    title: {
      default: seo.title,
      template: "%s | Kooch",
    },
    description: seo.description,
  };
}

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="fa"
      dir="rtl"
      suppressHydrationWarning
      className={iranYekan.variable}
    >
      <body className="font-sans min-h-screen antialiased">
        <AuthSessionProvider>
          <OwnerPropertyProvider>
            <Toaster closeButton dir="rtl" position="top-center" richColors />
            <script
              dangerouslySetInnerHTML={{
                __html:
                  "try{var t=localStorage.getItem('kooch_theme')||'ocean';document.documentElement.dataset.theme=t}catch(e){}",
              }}
            />
            <div className="flex min-h-screen flex-col">
              <Header />
              <main className="flex-1">{children}</main>
              <Footer />
            </div>
          </OwnerPropertyProvider>
        </AuthSessionProvider>
      </body>
    </html>
  );
}
