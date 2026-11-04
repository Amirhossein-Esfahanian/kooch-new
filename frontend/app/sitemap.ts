import type { MetadataRoute } from "next";
import { getPublicBookingProperties } from "@/lib/public-properties.server";
import { publicBookingUrl, publicFrontendOrigin } from "@/lib/public-booking-url";

export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  if (!publicFrontendOrigin(process.env.NEXT_PUBLIC_KOOCH_PUBLIC_ORIGIN)) {
    console.warn("Sitemap requires a valid NEXT_PUBLIC_KOOCH_PUBLIC_ORIGIN; no host will be guessed.");
    return [];
  }
  const properties = await getPublicBookingProperties();
  const urls = [...new Set(properties.filter((property) => property.status === "Approved")
    .map((property) => publicBookingUrl(property.slug)).filter((url): url is string => url !== null))];
  if (urls.length > 50_000) throw new Error("Direct booking sitemap exceeds the single-sitemap limit; partitioning is required.");
  return urls.map((url) => ({ url }));
}
