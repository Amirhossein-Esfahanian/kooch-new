import Link from "next/link";
import type { ReactNode } from "react";
import type { DirectSessionProperty } from "@/lib/property-booking-session";
import { PropertyGuestAccount } from "@/components/booking/PropertyGuestAccount";

export function PropertyBookingShell({ property, children }: { property: DirectSessionProperty; children: ReactNode }) {
  return <div className="min-h-screen bg-background text-foreground" dir="rtl">
    <header className="border-b border-border">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-5 sm:px-6">
        <Link className="text-xl font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" href={`/book/${encodeURIComponent(property.slug)}`}>
          {property.name}
        </Link>
        <PropertyGuestAccount slug={property.slug} />
      </div>
    </header>
    {children}
  </div>;
}
