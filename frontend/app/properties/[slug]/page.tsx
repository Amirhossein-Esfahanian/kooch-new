"use client";

import Image from "next/image";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { useAuthSession } from "@/components/auth/AuthSessionProvider";
import { useBookingUrlContext } from "@/hooks/useBookingUrlContext";
import {
  PropertyBookingPanel,
} from "@/components/booking/PropertyBookingPanel";
import { KoochButton } from "@/components/KoochButton";
import { KoochDialog } from "@/components/KoochDialog";
import { MarketplacePropertyDetail } from "@/components/property/marketplace/MarketplacePropertyDetail";
import {
  fetchPublicApi,
  PublicProperty,
  PublicRoomType,
} from "@/lib/public-properties";
import { shouldBypassImageOptimization } from "@/lib/image-delivery";
import { getToken } from "@/lib/auth-session";

const placeholder =
  "https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?auto=format&fit=crop&w=1200&q=80";

const visitSessionKey = "kooch.propertyVisit.sessionId.v1";
const pendingVisits = new Set<string>();

function getVisitSessionId(): string | null {
  try {
    const stored = sessionStorage.getItem(visitSessionKey);
    if (stored && /^[A-Za-z0-9_-]{32,128}$/.test(stored)) return stored;
    const generated = typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) =>
          byte.toString(16).padStart(2, "0")).join("");
    sessionStorage.setItem(visitSessionKey, generated);
    return generated;
  } catch {
    return null;
  }
}

function tehranVisitDate(): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Tehran", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date());
  const part = (type: string) => parts.find((item) => item.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

const bedLabels: Record<string, string> = {
  "Single Bed": "تخت یک‌نفره",
  "Double Bed": "تخت دابل",
  "Queen Bed": "تخت کویین",
  "King Bed": "تخت کینگ",
  "Twin Beds": "تخت تویین",
  "Sofa Bed": "مبل تخت‌خواب‌شو",
  "Traditional Floor Bedding": "رختخواب سنتی",
};

export default function PublicPropertyPage() {
  const { slug } = useParams<{ slug: string }>();
  const searchParams = useSearchParams();
  const { dates: bookingDates, setDates: setBookingDates, guests: bookingGuests,
    setGuests: setBookingGuests, autoCheckInitialContextKey } = useBookingUrlContext("properties", slug);
  const auth = useAuthSession();
  const [property, setProperty] = useState<PublicProperty | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [detailsRoomType, setDetailsRoomType] = useState<PublicRoomType | null>(
    null,
  );

  useEffect(() => {
    if (!slug) return;
    let current = true;
    fetchPublicApi<PublicProperty>(`/properties/${encodeURIComponent(slug)}`)
      .then((result) => { if (current) setProperty(result); })
      .catch((caught: Error) => { if (current) setError(caught.message); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [slug]);

  useEffect(() => {
    if (loading || error || !property || property.status !== "Approved" ||
        property.slug !== slug || auth.loading) return;
    if (auth.authenticated && (
      auth.platformRole === "SuperAdmin" || auth.platformRole === "AdminAssistant" ||
      auth.propertyMemberships?.some((membership) =>
        membership.propertyId === property.id && membership.isActive &&
        membership.membershipStatus === "Active")
    )) return;
    let token: string | null;
    try { token = auth.authenticated ? getToken() : null; }
    catch { return; }
    if (auth.authenticated && !token) return;

    let timer: ReturnType<typeof setTimeout> | undefined;
    const recordVisit = () => {
      timer = undefined;
      if (document.visibilityState !== "visible") return;
      const sessionId = getVisitSessionId();
      if (!sessionId) return;
      const visitKey = `kooch.propertyVisit.sent:${property.id}:${tehranVisitDate()}`;
      try {
        if (sessionStorage.getItem(visitKey) || pendingVisits.has(visitKey)) return;
      } catch { return; }
      pendingVisits.add(visitKey);
      void Promise.resolve().then(() => fetch(`/api/backend/properties/${encodeURIComponent(slug)}/visits`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ sessionId }),
      })).then((response) => {
        if (response.ok) sessionStorage.setItem(visitKey, "1");
      }).catch(() => {
        // Visit tracking must never affect the Property page.
      }).finally(() => pendingVisits.delete(visitKey));
    };
    const onVisibilityChange = () => {
      if (timer) clearTimeout(timer);
      timer = document.visibilityState === "visible"
        ? setTimeout(recordVisit, 2000) : undefined;
    };
    onVisibilityChange();
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [auth.authenticated, auth.loading, auth.platformRole, auth.propertyMemberships,
    error, loading, property, slug]);

  useEffect(() => {
    if (!property) return;
    document.title = property.seoTitle || property.name;
    const description = property.seoDescription || property.description;
    let meta = document.querySelector<HTMLMetaElement>(
      'meta[name="description"]',
    );
    if (!meta) {
      meta = document.createElement("meta");
      meta.name = "description";
      document.head.appendChild(meta);
    }
    meta.content = description;
  }, [property]);


  if (loading) return <PageMessage>در حال بارگذاری اقامتگاه...</PageMessage>;
  if (error || !property) return <PageMessage error="اقامتگاه پیدا نشد." />;

  const gallery = property.images.length
    ? property.images
    : [
        {
          id: -1,
          url: placeholder,
          altText: property.name,
          caption: null,
          tag: null,
          isCover: true,
        },
      ];
  const resultQuery = searchParams.toString();
  const resultsHref = resultQuery ? `/properties?${resultQuery}` : "/properties";

  return (
    <PropertyBookingPanel
      autoCheckInitialContextKey={autoCheckInitialContextKey}
      dates={bookingDates}
      galleryFallback={gallery[0].url}
      guests={bookingGuests}
      onDatesChange={setBookingDates}
      onGuestsChange={setBookingGuests}
      onShowRoomDetails={setDetailsRoomType}
      propertyId={property.id}
      propertyName={property.name}
      propertySlug={property.slug}
      roomTypes={property.roomTypes}
    >
      {({ searchBar, roomSelection }) => (
        <>
          <MarketplacePropertyDetail
            key={property.id}
            property={property}
            resultsHref={resultsHref}
            searchBar={searchBar}
            roomSelection={roomSelection}
          />
          <RoomTypeDetailsDialog
            galleryFallback={gallery[0].url}
            onOpenChange={(open) => { if (!open) setDetailsRoomType(null); }}
            roomType={detailsRoomType}
          />
        </>
      )}
    </PropertyBookingPanel>
  );
}

function RoomTypeDetailsDialog({
  roomType,
  galleryFallback,
  onOpenChange,
}: {
  roomType: PublicRoomType | null;
  galleryFallback: string;
  onOpenChange: (open: boolean) => void;
}) {
  const images = roomType?.images.length
    ? roomType.images
    : roomType
      ? [
          {
            id: -1,
            url: galleryFallback,
            altText: roomType.name,
            caption: null,
            tag: null,
            isCover: true,
          },
        ]
      : [];

  return (
    <KoochDialog
      description={roomType?.description || "تصاویر و مشخصات کامل اتاق"}
      footer={
        roomType ? (
          <KoochButton onClick={() => onOpenChange(false)} variant="outline">
            بستن
          </KoochButton>
        ) : null
      }
      onOpenChange={onOpenChange}
      open={roomType !== null}
      size="lg"
      title={roomType ? `جزئیات ${roomType.name}` : "جزئیات اتاق"}
    >
      {roomType && (
        <div className="grid gap-6">
          <div className="grid gap-3 sm:grid-cols-2">
            {images.map((image, index) => (
              <figure
                className="min-w-0 overflow-hidden rounded-lg border border-border bg-muted"
                key={image.id}
              >
                <Image
                  alt={image.altText || `${roomType.name}، تصویر ${index + 1}`}
                  className="aspect-[4/3] w-full object-cover"
                  height={720}
                  loading="lazy"
                  sizes="(max-width: 639px) calc(100vw - 5rem), 40vw"
                  src={image.url}
                  unoptimized={shouldBypassImageOptimization(image.url)}
                  width={960}
                />
                {image.caption && (
                  <figcaption className="px-3 py-2 text-sm leading-6 text-muted-foreground">
                    {image.caption}
                  </figcaption>
                )}
              </figure>
            ))}
          </div>

          <div className="grid gap-3 text-sm leading-7 text-foreground">
            <p>
              ظرفیت پایه: {roomType.maxAdults.toLocaleString("fa-IR")} بزرگسال
              {roomType.maxChildren > 0
                ? ` و ${roomType.maxChildren.toLocaleString("fa-IR")} کودک`
                : ""}
            </p>
            {roomType.bedInformation.length > 0 && (
              <p>
                تخت‌ها: {roomType.bedInformation.map(persianBed).join("، ")}
              </p>
            )}
            {roomType.amenities.length > 0 && (
              <div className="flex flex-wrap gap-2" aria-label="امکانات اتاق">
                {roomType.amenities.map((amenity) => (
                  <span
                    className="rounded-md bg-muted px-3 py-1 text-xs font-semibold text-muted-foreground"
                    key={amenity.id}
                  >
                    {amenity.name}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </KoochDialog>
  );
}

function persianBed(value: string) {
  const match = value.match(/^(\d+) x (.+)$/);
  return match ? `${match[1]} ${bedLabels[match[2]] ?? match[2]}` : value;
}

function PageMessage({
  children,
  error,
}: {
  children?: React.ReactNode;
  error?: string;
}) {
  return (
    <div className="mx-auto min-h-[60vh] max-w-7xl px-5 py-16" dir="rtl">
      {error ? (
        <>
          <p className="rounded-xl bg-red-50 p-6 text-red-700">{error}</p>
          <Link
            className="mt-5 inline-block font-bold text-blue-700"
            href="/properties"
          >
            بازگشت به اقامتگاه‌ها
          </Link>
        </>
      ) : (
        children
      )}
    </div>
  );
}
