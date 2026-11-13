"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { GuestReviewInvitation } from "@/components/reviews/GuestReviewInvitation";
import { UserProfileAvatarProvider } from "@/components/auth/UserProfileAvatarProvider";

export function PublicSiteShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const propertyLanding = /^\/book\/[^/]+(?:\/my-bookings|\/reservations\/[^/]+(?:\/(?:success|payment-failure|mock-payment))?)?\/?$/.test(pathname ?? "") ||
    /^\/booking\/sessions\/[^/]+\/(?:success|payment-failure|mock-payment)\/?$/.test(pathname ?? "");

  const content = (
    <div className="flex min-h-screen flex-col">
      <GuestReviewInvitation />
      {!propertyLanding && <Header />}
      <main className="flex-1">{children}</main>
      {!propertyLanding && <Footer />}
    </div>
  );
  return propertyLanding ? content : <UserProfileAvatarProvider eager>{content}</UserProfileAvatarProvider>;
}
