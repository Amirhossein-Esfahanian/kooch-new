import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PublicProperty } from "@/lib/public-properties";
import { propertyBookingMetadata, propertyBookingStructuredData, serializeStructuredData } from "@/lib/property-booking-seo";
import { getPublicBookingProperties, getPublicBookingProperty } from "@/lib/public-properties.server";
import sitemap from "@/app/sitemap";
import robots from "@/app/robots";

vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NEXT_HTTP_ERROR_FALLBACK;404"); } }));
vi.mock("@/components/booking/PropertyBookingLanding", () => ({
  PropertyBookingLanding: ({ initialProperty }: { initialProperty: PublicProperty }) => <h1>{initialProperty.name}</h1>,
}));
import Page, { dynamic, generateMetadata } from "@/app/book/[slug]/page";

const publicOrigin = "https://stays.example.test";
const apiOrigin = "https://api.example.test";
function property(overrides: Partial<PublicProperty> = {}): PublicProperty {
  return {
    id: 2, name: "خانه باغ", englishName: null, slug: "garden-house", seoTitle: null, seoDescription: null,
    city: "کاشان", country: "ایران", address: "خیابان باغ", description: "خانه‌ای تاریخی با حیاط مرکزی", shortDescription: "اقامت در باغ",
    coverImageUrl: "/uploads/house.webp", status: "Approved", propertyType: "TraditionalHouse", inventoryMode: "TypeBasedInventory",
    checkInTime: "14:00:00", checkOutTime: "12:00:00", regularReceptionFrom: null, regularReceptionUntil: null,
    latitude: 33.985, longitude: 51.41, hasElevator: false, isWheelchairAccessible: null, hasGroundFloorRoom: null,
    hasAccessibleBathroom: null, isInstantBooking: false, startingPrice: null, matchingRoomTypesCount: 0,
    matchingRoomTypes: [], guestFitStatus: "Unknown", availabilitySummary: "Unknown", availabilityStatusSummary: "Unknown",
    freeChildAgeLimit: null, maxFreeChildren: null, images: [], descriptionSections: [], commonAreas: [], settings: [],
    amenities: [], nearbyPlaces: [], views: [], roomTypes: [], ...overrides,
  };
}
function mockResponse(body: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("NEXT_PUBLIC_KOOCH_PUBLIC_ORIGIN", `${publicOrigin}/`);
  vi.stubEnv("KOOCH_BACKEND_ORIGIN", apiOrigin);
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockResponse(property())));
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("Direct metadata and structured data", () => {
  it("uses real Property-specific Persian content and a query-free self canonical", async () => {
    const metadata = await generateMetadata({ params: Promise.resolve({ slug: "garden-house" }) });
    expect(metadata.title).toEqual({ absolute: "رزرو خانه باغ | کاشان" });
    expect(metadata.description).toContain("خانه‌ای تاریخی با حیاط مرکزی");
    expect(metadata.alternates).toEqual({ canonical: `${publicOrigin}/book/garden-house` });
    expect(metadata.robots).toEqual({ index: true, follow: true });
    expect(metadata.openGraph).toMatchObject({ locale: "fa_IR", url: `${publicOrigin}/book/garden-house`,
      images: [{ url: `${publicOrigin}/uploads/house.webp`, alt: "خانه باغ" }] });
    expect(metadata.twitter).toMatchObject({ card: "summary_large_image", images: [`${publicOrigin}/uploads/house.webp`] });
    expect(propertyBookingMetadata(property({ name: "سرای آفتاب" })).title).not.toEqual(metadata.title);
    expect(propertyBookingMetadata(property({ name: "سرای آفتاب" })).description).not.toEqual(metadata.description);
    // The route takes only the slug; booking/tracking query values cannot enter the canonical.
    expect(JSON.stringify(metadata.alternates)).not.toMatch(/checkIn|utm_|properties\//);
  });

  it("normalizes HTML/whitespace, safely limits descriptions and encodes slugs", () => {
    const metadata = propertyBookingMetadata(property({ slug: "خانه-باغ", description: `<p>  ${"توضیحات ".repeat(80)}</p>` }));
    expect(Array.from(metadata.description ?? "").length).toBeLessThanOrEqual(160);
    expect(metadata.description).not.toMatch(/<p>|\s{2}/);
    expect(metadata.alternates).toEqual({ canonical: `${publicOrigin}/book/${encodeURIComponent("خانه-باغ")}` });
  });

  it.each(["", "not-an-origin", "https://public.test/path", "http://public.test"])("never invents a host for invalid config (%s)", (origin) => {
    vi.stubEnv("NEXT_PUBLIC_KOOCH_PUBLIC_ORIGIN", origin);
    const metadata = propertyBookingMetadata(property());
    expect(metadata.alternates).toBeUndefined();
    expect(metadata.openGraph).not.toHaveProperty("url");
    expect(propertyBookingStructuredData(property())).not.toHaveProperty("url");
    expect(JSON.stringify(metadata)).not.toContain(apiOrigin);
  });

  it("uses a real fallback image, otherwise omits imagery rather than inventing it", () => {
    const data = property({ coverImageUrl: "javascript:bad", images: [{ id: 1, url: "/uploads/real.png", altText: null, caption: null, tag: null, isCover: true }] });
    expect(propertyBookingMetadata(data).twitter).toMatchObject({ images: [`${publicOrigin}/uploads/real.png`] });
    const metadata = propertyBookingMetadata(property({ coverImageUrl: null }));
    expect(metadata.openGraph).toHaveProperty("images", []);
    expect(metadata.twitter).toMatchObject({ card: "summary", images: [] });
    expect(propertyBookingStructuredData(property({ coverImageUrl: null }))).not.toHaveProperty("image");
    const cdnImage = "https://images.unsplash.com/photo-1566073771259-6a8506099945?auto=format&fit=crop";
    expect(propertyBookingStructuredData(property({ coverImageUrl: cdnImage }))).toHaveProperty("image", cdnImage);
  });

  it.each(["/api/private.png", "https://user:pass@cdn.test/p.png", "https://127.0.0.1/p.png", "https://cdn.local/p.png", "//evil.test/p.png", "data:image/png,abc"])("omits unsafe/private image URLs (%s)", (image) => {
    expect(propertyBookingStructuredData(property({ coverImageUrl: image }))).not.toHaveProperty("image");
  });

  it("uses a conservative lodging type, real address/coordinates and no commercial claims", () => {
    expect(propertyBookingStructuredData(property())).toEqual({
      "@context": "https://schema.org", "@type": "LodgingBusiness", name: "خانه باغ",
      description: "رزرو خانه باغ در کاشان. خانه‌ای تاریخی با حیاط مرکزی",
      url: `${publicOrigin}/book/garden-house`, image: `${publicOrigin}/uploads/house.webp`,
      address: { "@type": "PostalAddress", streetAddress: "خیابان باغ", addressLocality: "کاشان", addressCountry: "ایران" },
      geo: { "@type": "GeoCoordinates", latitude: 33.985, longitude: 51.41 },
    });
    expect(JSON.stringify(propertyBookingStructuredData(property()))).not.toMatch(/rating|offers|price|review|Hotel/);
    expect(propertyBookingStructuredData(property({ latitude: 91 }))).not.toHaveProperty("geo");
    expect(propertyBookingStructuredData(property({ city: "", address: "", country: "", latitude: null }))).not.toHaveProperty("address");
  });

  it("serializes JSON-LD without executable script breakout or lost Persian text", () => {
    const schema = { ...propertyBookingStructuredData(property()), name: "خانه </script><script>alert(1)</script> & باغ\u2028" };
    const serialized = serializeStructuredData(schema);
    expect(serialized).not.toMatch(/[<>&\u2028\u2029]/);
    expect(JSON.parse(serialized)).toEqual(schema);
    expect(serialized).toContain("خانه");
  });
});

describe("public server boundary and route", () => {
  it("uses anonymous API-only no-store reads and request-time rendering", async () => {
    await getPublicBookingProperty("garden-house");
    expect(fetch).toHaveBeenCalledExactlyOnceWith(new URL(`${apiOrigin}/api/properties/garden-house`), {
      cache: "no-store", credentials: "omit", signal: expect.any(AbortSignal),
    });
    expect(dynamic).toBe("force-dynamic");
    const html = renderToStaticMarkup(await Page({ params: Promise.resolve({ slug: "garden-house" }) }));
    expect(html).toContain("<h1>خانه باغ</h1>");
    expect(html).toContain('type="application/ld+json"');
    expect(html).not.toMatch(/ratingValue|BookingSession|protectedToken/);
  });

  it.each(["Draft", "PendingReview", "Rejected", "Suspended"])("does not render/index a non-public %s response", async (status) => {
    vi.mocked(fetch).mockResolvedValue(mockResponse({ ...property(), status }));
    await expect(Page({ params: Promise.resolve({ slug: "hidden" }) })).rejects.toThrow("404");
    await expect(generateMetadata({ params: Promise.resolve({ slug: "hidden" }) })).rejects.toThrow("404");
  });

  it("handles missing Property with notFound, without misclassifying API failures as missing", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(mockResponse({}, 404));
    await expect(Page({ params: Promise.resolve({ slug: "missing" }) })).rejects.toThrow("404");
    vi.mocked(fetch).mockResolvedValueOnce(mockResponse({}, 503));
    await expect(Page({ params: Promise.resolve({ slug: "garden-house" }) })).rejects.toThrow("503");
  });

  it("does not guess the API origin in production", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.stubEnv("KOOCH_BACKEND_ORIGIN", "");
    await expect(getPublicBookingProperty("garden-house")).rejects.toThrow("KOOCH_BACKEND_ORIGIN");
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("sitemap and robots", () => {
  it("lists only Approved Direct pages once, using one list read without invented updated dates", async () => {
    vi.mocked(fetch).mockResolvedValue(mockResponse([property(), property(), property({ slug: "second" }),
      { ...property(), slug: "hidden", status: "Rejected" }, property({ slug: "../invalid" })]));
    expect(await sitemap()).toEqual([{ url: `${publicOrigin}/book/garden-house` }, { url: `${publicOrigin}/book/second` }]);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(vi.mocked(fetch).mock.calls[0][0]).toEqual(new URL(`${apiOrigin}/api/properties`));
  });

  it("omits sitemap URLs and does not fetch without a valid public origin", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.stubEnv("NEXT_PUBLIC_KOOCH_PUBLIC_ORIGIN", "");
    expect(await sitemap()).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
    expect(robots()).not.toHaveProperty("sitemap");
  });

  it("does not silently turn a failed list read into a successful empty sitemap", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(mockResponse([], 503));
    await expect(sitemap()).rejects.toThrow("503");
    vi.mocked(fetch).mockResolvedValueOnce(mockResponse({}));
    await expect(getPublicBookingProperties()).rejects.toThrow("Invalid public Property list");
  });

  it("allows Direct and Marketplace crawling while keeping checkout and private routes out", () => {
    const result = robots();
    expect(result.sitemap).toBe(`${publicOrigin}/sitemap.xml`);
    expect(result.rules).toMatchObject({ userAgent: "*", allow: "/", disallow: expect.arrayContaining(["/account", "/owner", "/admin", "/booking/", "/api/"]) });
    expect((result.rules as { disallow: string[] }).disallow).not.toContain("/book/");
    expect((result.rules as { disallow: string[] }).disallow).not.toContain("/properties/");
  });
});
