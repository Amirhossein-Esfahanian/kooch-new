import type { Metadata } from "next";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { PropertyBookingLanding } from "@/components/booking/PropertyBookingLanding";
import { getPublicBookingProperty } from "@/lib/public-properties.server";
import { publicBookingUrl } from "@/lib/public-booking-url";
import { propertyBookingMetadata, propertyBookingStructuredData, serializeStructuredData } from "@/lib/property-booking-seo";

// Request-time visibility checks also keep useSearchParams from bailing out to CSR.
export const dynamic = "force-dynamic";
type PageProps = { params: Promise<{ slug: string }> };
let warnedMissingOrigin = false;

async function loadProperty(params: PageProps["params"]) {
  const { slug } = await params;
  const property = await getPublicBookingProperty(slug);
  if (!property) notFound();
  if (!publicBookingUrl(property.slug) && !warnedMissingOrigin) {
    console.warn("Direct booking SEO requires a valid NEXT_PUBLIC_KOOCH_PUBLIC_ORIGIN; canonical URLs are unavailable.");
    warnedMissingOrigin = true;
  }
  return { property, slug };
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  return propertyBookingMetadata((await loadProperty(params)).property);
}

export default async function PropertyBookingLandingPage({ params }: PageProps) {
  const { property, slug } = await loadProperty(params);
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeStructuredData(propertyBookingStructuredData(property)) }} />
      <Suspense fallback={<div aria-busy="true" className="grid min-h-screen place-items-center bg-background text-foreground" role="status">در حال دریافت اقامتگاه…</div>}>
        <PropertyBookingLanding initialProperty={property} initialSlug={slug} />
      </Suspense>
    </>
  );
}
