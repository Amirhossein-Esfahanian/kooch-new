import { notFound } from "next/navigation";
import { getPublicBookingProperty } from "@/lib/public-properties.server";
import { PropertyMyBookings } from "@/components/booking/PropertyMyBookings";

export const metadata = { title: { absolute: "رزروهای من در اقامتگاه" }, robots: { index: false, follow: false } };

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const property = await getPublicBookingProperty(slug);
  if (!property || property.slug !== slug) notFound();
  return <PropertyMyBookings property={{ id: property.id, slug: property.slug, name: property.name }} />;
}
