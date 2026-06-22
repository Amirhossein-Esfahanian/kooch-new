import type { Metadata } from "next";
import { Footer } from "@/components/Footer";
import { Header } from "@/components/Header";
import { Toaster } from "sonner";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Kooch | Find your next stay",
    template: "%s | Kooch",
  },
  description: "Thoughtful stays for slow mornings and memorable journeys.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="fa" dir="rtl">
      <body className="min-h-screen antialiased">
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
      </body>
    </html>
  );
}
