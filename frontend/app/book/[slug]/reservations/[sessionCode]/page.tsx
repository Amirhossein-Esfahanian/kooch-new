import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BookingSessionDetail } from "@/components/booking/BookingSessionDetail";
import { getPublicBookingProperty } from "@/lib/public-properties.server";

export const metadata: Metadata = {
  title: { absolute: "جزئیات رزرو اقامتگاه" },
  robots: { index: false, follow: false },
};

export default async function PropertyBookingSessionPage({ params }: {
  params: Promise<{ slug: string; sessionCode: string }>;
}) {
  const { slug } = await params;
  const property = await getPublicBookingProperty(slug);
  if (!property || property.slug !== slug) notFound();
  const directProperty = { id: property.id, name: property.name, slug: property.slug };
  return <div className="min-h-screen bg-background text-foreground" dir="rtl">
    <header className="border-b border-border">
      <div className="mx-auto max-w-5xl px-4 py-5 sm:px-6">
        <Link className="text-xl font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" href={`/book/${encodeURIComponent(property.slug)}`}>
          {property.name}
        </Link>
      </div>
    </header>
    <BookingSessionDetail directProperty={directProperty} />
  </div>;
}
