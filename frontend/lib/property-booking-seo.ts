import type { Metadata } from "next";
import type { PublicProperty } from "@/lib/public-properties";
import { publicBookingUrl } from "@/lib/public-booking-url";
import { shouldBypassImageOptimization } from "@/lib/image-delivery";

function text(value: string | null | undefined, limit = 160): string {
  const plain = (value ?? "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  const characters = Array.from(plain);
  return characters.length > limit ? `${characters.slice(0, limit - 1).join("").trimEnd()}…` : plain;
}

function description(property: PublicProperty) {
  const location = text(property.city, 50);
  const information = text(property.description) || text(property.shortDescription);
  return text(`رزرو ${text(property.name, 80)}${location ? ` در ${location}` : ""}.${information ? ` ${information}` : ""}`);
}

function publicImage(property: PublicProperty, canonical: string | null): string | undefined {
  if (!canonical) return undefined;
  const sources = [property.coverImageUrl, ...property.images.map((image) => image.url)];
  for (const source of sources) {
    if (!source?.trim()) continue;
    try {
      // Local upload URLs are served by the existing public frontend rewrite.
      if (!source.startsWith("/") && !source.startsWith("https://")) continue;
      if (source.startsWith("//") || /[\\\s]/.test(source)) continue;
      const url = new URL(source, canonical);
      if (url.username || url.password || url.hash) continue;
      if (!/\.(avif|gif|jpe?g|png|webp)$/i.test(url.pathname) && shouldBypassImageOptimization(url.href)) continue;
      if (/^\/(api|admin|owner|account|booking)(\/|$)/i.test(url.pathname)) continue;
      if (url.origin !== new URL(canonical).origin && (
        url.hostname === "localhost" || url.hostname.endsWith(".localhost") || url.hostname.endsWith(".local") ||
        !url.hostname.includes(".") || /^[\d.]+$/.test(url.hostname) || url.hostname.startsWith("[")
      )) continue;
      return url.href;
    } catch { /* Omit malformed assets instead of inventing a social image. */ }
  }
  return undefined;
}

export function propertyBookingMetadata(property: PublicProperty): Metadata {
  const canonical = publicBookingUrl(property.slug);
  const title = text(`رزرو ${text(property.name, 80)}${property.city ? ` | ${text(property.city, 50)}` : ""}`, 140);
  const summary = description(property);
  const image = publicImage(property, canonical);
  return {
    title: { absolute: title },
    description: summary,
    ...(canonical ? { alternates: { canonical } } : {}),
    robots: { index: true, follow: true },
    openGraph: {
      type: "website", locale: "fa_IR", title, description: summary,
      ...(canonical ? { url: canonical } : {}),
      images: image ? [{ url: image, alt: text(property.name) }] : [],
    },
    twitter: {
      card: image ? "summary_large_image" : "summary", title, description: summary,
      images: image ? [image] : [],
    },
  };
}

export function propertyBookingStructuredData(property: PublicProperty) {
  const canonical = publicBookingUrl(property.slug);
  const image = publicImage(property, canonical);
  const address = {
    ...(text(property.address) ? { streetAddress: text(property.address) } : {}),
    ...(text(property.city) ? { addressLocality: text(property.city) } : {}),
    ...(text(property.country) ? { addressCountry: text(property.country) } : {}),
  };
  const hasLocation = typeof property.latitude === "number" && Number.isFinite(property.latitude) &&
    Math.abs(property.latitude) <= 90 && typeof property.longitude === "number" &&
    Number.isFinite(property.longitude) && Math.abs(property.longitude) <= 180;
  return {
    "@context": "https://schema.org",
    "@type": "LodgingBusiness",
    name: text(property.name), description: description(property),
    ...(canonical ? { url: canonical } : {}),
    ...(image ? { image } : {}),
    ...(Object.keys(address).length ? { address: { "@type": "PostalAddress", ...address } } : {}),
    ...(hasLocation ? { geo: { "@type": "GeoCoordinates", latitude: property.latitude, longitude: property.longitude } } : {}),
  };
}

export function serializeStructuredData(value: ReturnType<typeof propertyBookingStructuredData>): string {
  return JSON.stringify(value).replace(/[<>&\u2028\u2029]/g, (character) =>
    `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`);
}
