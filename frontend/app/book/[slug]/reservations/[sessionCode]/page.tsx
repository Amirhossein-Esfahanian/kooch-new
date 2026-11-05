import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BookingSessionDetail } from "@/components/booking/BookingSessionDetail";
import { getPublicBookingProperty } from "@/lib/public-properties.server";
import { PropertyBookingShell } from "@/components/booking/PropertyBookingShell";

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
  return <PropertyBookingShell property={directProperty}>
    <BookingSessionDetail directProperty={directProperty} />
  </PropertyBookingShell>;
}
