import { notFound } from "next/navigation";
import { getPublicBookingProperty } from "@/lib/public-properties.server";
import type { BookingPaymentPageKind } from "@/lib/property-booking-session";
import { PropertyBookingPaymentEntry } from "@/components/booking/PropertyBookingPaymentEntry";

export async function PropertyBookingPaymentPage({ slug, sessionCode, kind }: { slug: string; sessionCode: string; kind: BookingPaymentPageKind }) {
  const property = await getPublicBookingProperty(slug);
  if (!property || property.slug !== slug) notFound();
  return <PropertyBookingPaymentEntry sessionCode={sessionCode} kind={kind} directProperty={{ id: property.id, slug: property.slug, name: property.name }} />;
}
