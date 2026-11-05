import Link from "next/link";
import type { ReactNode } from "react";
import type { DirectSessionProperty } from "@/lib/property-booking-session";

export function PropertyBookingShell({ property, children }: { property: DirectSessionProperty; children: ReactNode }) {
  return <div className="min-h-screen bg-background text-foreground" dir="rtl">
    <header className="border-b border-border">
      <div className="mx-auto max-w-5xl px-4 py-5 sm:px-6">
        <Link className="text-xl font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" href={`/book/${encodeURIComponent(property.slug)}`}>
          {property.name}
        </Link>
      </div>
    </header>
    {children}
  </div>;
}
