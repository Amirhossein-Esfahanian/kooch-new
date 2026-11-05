import Link from "next/link";
import type { ReactNode } from "react";
import type { DirectSessionProperty } from "@/lib/property-booking-session";
import { PropertyGuestAccount } from "@/components/booking/PropertyGuestAccount";
import styles from "./PropertyDirectGuest.module.css";

export function PropertyBookingShell({ property, children }: { property: DirectSessionProperty; children: ReactNode }) {
  return <div className={`min-h-screen ${styles.scope} ${styles.bookingSurface}`} dir="rtl">
    <header className="border-b border-border">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-5 sm:px-6">
        <Link className="text-xl font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" href={`/book/${encodeURIComponent(property.slug)}`}>
          {property.name}
        </Link>
        <PropertyGuestAccount slug={property.slug} propertyName={property.name} navigation={[
          { href: `/book/${encodeURIComponent(property.slug)}#booking`, label: "رزرو اقامت" },
          { href: `/book/${encodeURIComponent(property.slug)}#property-introduction`, label: "درباره اقامتگاه" },
        ]} />
      </div>
    </header>
    {children}
  </div>;
}
