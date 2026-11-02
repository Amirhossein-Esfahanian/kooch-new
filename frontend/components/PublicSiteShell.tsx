"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";

export function PublicSiteShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const propertyLanding = /^\/book\/[^/]+\/?$/.test(pathname ?? "");

  return (
    <div className="flex min-h-screen flex-col">
      {!propertyLanding && <Header />}
      <main className="flex-1">{children}</main>
      {!propertyLanding && <Footer />}
    </div>
  );
}
