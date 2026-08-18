"use client";

import Image from "next/image";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import type { GuestSelectorValue } from "@/components/GuestSelector";
import { PropertyBookingPanel } from "@/components/booking/PropertyBookingPanel";
import { KoochButton } from "@/components/KoochButton";
import { KoochDialog } from "@/components/KoochDialog";
import { PromotionCards } from "@/components/promotions/PromotionCards";
import {
  fetchPublicApi,
  formatPrice,
  PublicImage,
  PublicProperty,
  PublicRoomType,
} from "@/lib/public-properties";
import { shouldBypassImageOptimization } from "@/lib/image-delivery";

const placeholder =
  "https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?auto=format&fit=crop&w=1200&q=80";

const propertyTypeLabels: Record<string, string> = {
  TraditionalHouse: "خانه سنتی",
  BoutiqueHotel: "هتل بوتیک",
  EcoLodge: "اقامتگاه بوم‌گردی",
  Hotel: "هتل",
  Villa: "ویلا",
  Apartment: "آپارتمان",
};

const sectionLabels: Record<string, string> = {
  PropertyIntroduction: "معرفی اقامتگاه",
  ImportantNotes: "نکات مهم",
};

const viewLabels: Record<string, string> = {
  CourtyardView: "نمای حیاط",
  GardenView: "نمای باغ",
  CityView: "نمای شهر",
  MountainView: "نمای کوه",
  DesertView: "نمای کویر",
};

const bedLabels: Record<string, string> = {
  "Single Bed": "تخت یک‌نفره",
  "Double Bed": "تخت دابل",
  "Queen Bed": "تخت کویین",
  "King Bed": "تخت کینگ",
  "Twin Beds": "تخت تویین",
  "Sofa Bed": "مبل تخت‌خواب‌شو",
  "Traditional Floor Bedding": "رختخواب سنتی",
};

const availabilityLabels: Record<string, string> = {
  Available: "موجود",
  Unavailable: "ناموجود",
  OnRequest: "نیازمند استعلام",
};

function readPositiveNumber(value: string | null, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function readGuestParams(
  searchParams: Pick<URLSearchParams, "get">,
): GuestSelectorValue {
  const children = Math.max(
    0,
    readPositiveNumber(searchParams.get("children"), 0),
  );
  const childAges = (searchParams.get("childAges") ?? "")
    .split(",")
    .filter(Boolean)
    .map((age) => Number(age))
    .filter((age) => Number.isFinite(age))
    .slice(0, children);

  while (childAges.length < children) childAges.push(5);

  return {
    rooms: readPositiveNumber(searchParams.get("rooms"), 1),
    adults: readPositiveNumber(
      searchParams.get("adults") ?? searchParams.get("guests"),
      2,
    ),
    children,
    childAges,
  };
}

export default function PublicPropertyPage() {
  const { slug } = useParams<{ slug: string }>();
  const searchParams = useSearchParams();
  const [property, setProperty] = useState<PublicProperty | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [detailsRoomType, setDetailsRoomType] = useState<PublicRoomType | null>(
    null,
  );
  const [preferredRoomTypeId, setPreferredRoomTypeId] = useState<number | null>(
    null,
  );
  const bookingPanelRef = useRef<HTMLElement>(null);
  const [bookingDates, setBookingDates] = useState<{
    startDate: string | null;
    endDate: string | null;
  }>({
    startDate: searchParams.get("checkIn"),
    endDate: searchParams.get("checkOut"),
  });
  const [bookingGuests, setBookingGuests] = useState<GuestSelectorValue>(() =>
    readGuestParams(searchParams),
  );

  useEffect(() => {
    if (!slug) return;
    fetchPublicApi<PublicProperty>(`/properties/${encodeURIComponent(slug)}`)
      .then(setProperty)
      .catch((caught: Error) => setError(caught.message))
      .finally(() => setLoading(false));
  }, [slug]);

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

  useEffect(() => {
    setBookingDates({
      startDate: searchParams.get("checkIn"),
      endDate: searchParams.get("checkOut"),
    });
    setBookingGuests(readGuestParams(searchParams));
  }, [searchParams]);

  const groupedAmenities = useMemo(() => {
    const groups = new Map<string, PublicProperty["amenities"]>();
    for (const amenity of property?.amenities ?? []) {
      groups.set(amenity.category, [
        ...(groups.get(amenity.category) ?? []),
        amenity,
      ]);
    }
    return [...groups.entries()];
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
  const descriptions = property.descriptionSections.length
    ? property.descriptionSections
    : [
        {
          sectionType: "PropertyIntroduction" as const,
          title: "",
          content: property.description,
          sortOrder: 0,
        },
      ];
  const accessibility = [
    ["مناسب ویلچر", property.isWheelchairAccessible],
    ["آسانسور", property.hasElevator],
    ["اتاق همکف", property.hasGroundFloorRoom],
    ["سرویس مناسب افراد کم‌توان", property.hasAccessibleBathroom],
  ].filter(([, value]) => value !== null);
  const breakfastLabel = {
    NoBreakfast: "بدون صبحانه",
    Included: "صبحانه رایگان",
    Paid: "صبحانه با هزینه",
  }[property.breakfastOption];
  const resultQuery = searchParams.toString();
  const resultsHref = resultQuery
    ? `/properties?${resultQuery}`
    : "/properties";

  function selectRoomType(roomType: PublicRoomType) {
    setPreferredRoomTypeId(roomType.id);
    setDetailsRoomType(null);

    window.requestAnimationFrame(() => {
      bookingPanelRef.current?.scrollIntoView?.({
        behavior: "smooth",
        block: "start",
      });
      bookingPanelRef.current?.focus({ preventScroll: true });
    });
  }

  return (
    <div className="bg-slate-50 px-5 py-8 text-slate-900 sm:px-8" dir="rtl">
      <div className="mx-auto max-w-7xl">
        <Link className="text-sm font-bold text-blue-700" href={resultsHref}>
          بازگشت به نتایج جست‌وجو
        </Link>

        <header className="mt-5 flex flex-wrap items-start justify-between gap-5">
          <div>
            <div className="flex gap-2">
              <Badge>
                {propertyTypeLabels[property.propertyType] ??
                  property.propertyType}
              </Badge>
              <Badge green>تایید شده</Badge>
              <Badge>{breakfastLabel}</Badge>
            </div>
            <h1 className="mt-3 text-3xl font-black sm:text-5xl">
              {property.name}
            </h1>
            {property.englishName && (
              <p className="mt-2 text-sm text-slate-400" dir="ltr">
                {property.englishName}
              </p>
            )}
            <p className="mt-3 text-slate-600">
              {property.address}، {property.city}
            </p>
          </div>
        </header>

        <PromotionCards
          className="mt-6"
          promotions={property.promotions}
          title="پیشنهادهای فعال این اقامتگاه"
        />

        <section className="relative mt-7 grid h-[430px] grid-cols-2 grid-rows-2 gap-2 overflow-hidden rounded-2xl md:grid-cols-4">
          <Gallery
            image={gallery[0]}
            className="col-span-2 row-span-2"
            name={property.name}
            priority
            sizes="(max-width: 767px) 100vw, 50vw"
          />
          {[1, 2, 3, 4].map((index) => (
            <Gallery
              image={gallery[index] ?? gallery[0]}
              className={index > 2 ? "hidden md:block" : ""}
              key={index}
              name={property.name}
              sizes="(max-width: 767px) 50vw, 25vw"
            />
          ))}
          <button
            className="absolute bottom-4 left-4 rounded-lg bg-white px-4 py-2 text-sm font-bold shadow-lg"
            type="button"
          >
            مشاهده همه تصاویر ({property.images.length})
          </button>
        </section>

        <div className="mt-8">
          <div className="grid gap-8">
            <section>
              <h2 className="text-2xl font-black">اطلاعات سریع</h2>
              <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                <Highlight
                  title="ساعت ورود"
                  value={property.checkInTime?.slice(0, 5) ?? "ثبت نشده"}
                />
                <Highlight
                  title="ساعت خروج"
                  value={property.checkOutTime?.slice(0, 5) ?? "ثبت نشده"}
                />
                <Highlight
                  title="صبحانه"
                  value={
                    property.breakfastOption === "Paid" &&
                    property.breakfastPrice != null
                      ? `${breakfastLabel} (${formatPrice(property.breakfastPrice)})`
                      : breakfastLabel
                  }
                />
                <Highlight
                  title="نوع اقامتگاه"
                  value={
                    propertyTypeLabels[property.propertyType] ??
                    property.propertyType
                  }
                />
                <Highlight
                  title="نوع رزرو"
                  value={
                    property.isInstantBooking
                      ? "رزرو آنی"
                      : "نیازمند تایید میزبان"
                  }
                />
              </div>
            </section>

            <section className="rounded-2xl bg-white p-6 shadow-sm">
              <h2 className="text-2xl font-black">درباره اقامتگاه</h2>
              <div className="mt-5 grid gap-6">
                {descriptions.map((section) => (
                  <article key={section.sectionType}>
                    <h3 className="text-lg font-bold">
                      {section.title || sectionLabels[section.sectionType]}
                    </h3>
                    <p className="mt-2 whitespace-pre-line leading-8 text-slate-600">
                      {section.content}
                    </p>
                  </article>
                ))}
              </div>
            </section>

            {property.commonAreas.length > 0 && (
              <section>
                <h2 className="text-2xl font-black">فضاهای مشترک</h2>
                <div className="mt-5 grid gap-3 sm:grid-cols-2">
                  {property.commonAreas.map((area) => (
                    <article
                      className="rounded-xl border bg-white p-5"
                      key={area.id}
                    >
                      <h3 className="font-black">{area.name}</h3>
                      {area.description && (
                        <p className="mt-2 text-sm leading-7 text-slate-600">
                          {area.description}
                        </p>
                      )}
                    </article>
                  ))}
                </div>
              </section>
            )}

            {property.views.length > 0 && (
              <section>
                <h2 className="text-2xl font-black">چشم‌اندازها</h2>
                <div className="mt-4 flex flex-wrap gap-2">
                  {property.views.map((view) => (
                    <span
                      className="rounded-full border bg-white px-3 py-1.5 text-sm font-bold"
                      key={view}
                    >
                      {viewLabels[view] ?? view}
                    </span>
                  ))}
                </div>
              </section>
            )}

            {accessibility.length > 0 && (
              <section>
                <h2 className="text-2xl font-black">دسترسی‌پذیری</h2>
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  {accessibility.map(([label, value]) => (
                    <article
                      className="rounded-xl border bg-white p-4"
                      key={String(label)}
                    >
                      <p className="text-sm font-bold text-slate-500">
                        {label}
                      </p>
                      <p
                        className={`mt-2 font-black ${value ? "text-green-700" : "text-slate-500"}`}
                      >
                        {value ? "دارد" : "ندارد"}
                      </p>
                    </article>
                  ))}
                </div>
              </section>
            )}

            <section>
              <h2 className="text-2xl font-black">امکانات</h2>
              {groupedAmenities.length ? (
                <div className="mt-5 grid gap-4 sm:grid-cols-2">
                  {groupedAmenities.map(([category, amenities]) => (
                    <article
                      className="rounded-xl border bg-white p-5"
                      key={category}
                    >
                      <h3 className="font-black">{category}</h3>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {amenities.map((amenity) => (
                          <span
                            className="rounded-full bg-slate-100 px-3 py-1.5 text-sm font-semibold"
                            key={amenity.id}
                          >
                            {amenity.name}
                          </span>
                        ))}
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <Empty>هنوز امکاناتی ثبت نشده است.</Empty>
              )}
            </section>

            <section>
              <h2 className="text-2xl font-black">انتخاب اتاق</h2>
              <div className="mt-5 grid gap-6">
                <div className="grid gap-5">
                  {property.roomTypes.length ? (
                    property.roomTypes.map((roomType) => (
                      <RoomTypeCard
                        galleryFallback={gallery[0].url}
                        isPreferred={preferredRoomTypeId === roomType.id}
                        key={roomType.id}
                        onSelect={() => selectRoomType(roomType)}
                        onShowDetails={() => setDetailsRoomType(roomType)}
                        roomType={roomType}
                      />
                    ))
                  ) : (
                    <Empty>هنوز اتاق فعالی ثبت نشده است.</Empty>
                  )}
                </div>

                <aside
                  aria-label="رزرو اقامتگاه"
                  className="rounded-2xl border border-border bg-card p-5 shadow-lg"
                  ref={bookingPanelRef}
                  tabIndex={-1}
                >
                  <PropertyBookingPanel
                    dates={bookingDates}
                    guests={bookingGuests}
                    onDatesChange={setBookingDates}
                    onGuestsChange={setBookingGuests}
                    preferredRoomTypeId={preferredRoomTypeId}
                    preferredRoomTypeName={property.roomTypes.find((roomType) => roomType.id === preferredRoomTypeId)?.name ?? null}
                    propertyId={property.id}
                    propertyName={property.name}
                    propertySlug={property.slug}
                    startingPrice={property.startingPrice}
                  />
                </aside>
              </div>
            </section>

            <section>
              <h2 className="text-2xl font-black">مکان‌های نزدیک</h2>
              {property.nearbyPlaces.length ? (
                <div className="mt-5 overflow-x-auto rounded-xl border bg-white">
                  <table className="w-full min-w-[520px] text-sm">
                    <thead className="bg-slate-100 text-slate-500">
                      <tr>
                        <th className="p-3 text-right">مکان</th>
                        <th className="p-3 text-right">پیاده</th>
                        <th className="p-3 text-right">با خودرو</th>
                      </tr>
                    </thead>
                    <tbody>
                      {property.nearbyPlaces.map((place) => (
                        <tr className="border-t" key={place.id}>
                          <td className="p-3 font-bold">{place.title}</td>
                          <td className="p-3">
                            {place.walkingMinutes != null
                              ? `${place.walkingMinutes} دقیقه`
                              : "-"}
                          </td>
                          <td className="p-3">
                            {place.drivingMinutes != null
                              ? `${place.drivingMinutes} دقیقه`
                              : "-"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <Empty>مکان نزدیکی ثبت نشده است.</Empty>
              )}
            </section>

            <section>
              <h2 className="text-2xl font-black">موقعیت</h2>
              <div className="mt-4 grid min-h-64 place-items-center rounded-2xl border border-dashed border-blue-300 bg-blue-50 text-center">
                <div>
                  <strong className="text-blue-800">
                    نقشه به‌زودی اضافه می‌شود
                  </strong>
                  <p className="mt-2 text-sm text-blue-700">{property.city}</p>
                </div>
              </div>
            </section>
          </div>

        </div>
      </div>

      <RoomTypeDetailsDialog
        galleryFallback={gallery[0].url}
        onOpenChange={(open) => {
          if (!open) setDetailsRoomType(null);
        }}
        onSelect={selectRoomType}
        roomType={detailsRoomType}
      />
    </div>
  );
}

function RoomTypeCard({
  roomType,
  galleryFallback,
  isPreferred,
  onSelect,
  onShowDetails,
}: {
  roomType: PublicRoomType;
  galleryFallback: string;
  isPreferred: boolean;
  onSelect: () => void;
  onShowDetails: () => void;
}) {
  const details = [
    roomType.floorNumber != null ? `طبقه ${roomType.floorNumber}` : "",
    roomType.stairCount != null ? `${roomType.stairCount} پله` : "",
    roomType.hasPrivateBathroom == null
      ? ""
      : roomType.hasPrivateBathroom
        ? "سرویس بهداشتی اختصاصی"
        : "سرویس مشترک",
    roomType.hasWindow == null
      ? ""
      : roomType.hasWindow
        ? "دارای پنجره"
        : "بدون پنجره",
  ].filter(Boolean);

  return (
    <article className="overflow-hidden rounded-2xl border bg-white shadow-sm">
      <div className="grid md:grid-cols-[220px_minmax(0,1fr)_190px]">
        <Image
          alt={roomType.name}
          className="h-full min-h-52 w-full object-cover"
          height={624}
          loading="lazy"
          sizes="(max-width: 767px) calc(100vw - 2.5rem), 220px"
          src={roomType.images[0]?.url ?? galleryFallback}
          unoptimized={shouldBypassImageOptimization(
            roomType.images[0]?.url ?? galleryFallback,
          )}
          width={660}
        />
        <div className="p-5">
          <h3 className="text-xl font-black">{roomType.name}</h3>
          {roomType.englishName && (
            <p className="mt-1 text-xs text-slate-400" dir="ltr">
              {roomType.englishName}
            </p>
          )}
          <p className="mt-3 text-sm font-semibold text-slate-700">
            {roomType.maxAdults + roomType.maxChildren} نفر |{" "}
            {roomType.bedInformation.map(persianBed).join(" | ") ||
              "ترکیب تخت ثبت نشده"}
          </p>
          <p className="mt-3 text-sm leading-7 text-slate-600">
            {roomType.description}
          </p>
          {details.length > 0 && (
            <p className="mt-3 text-sm font-semibold text-slate-700">
              {details.join(" | ")}
            </p>
          )}
          {roomType.notes && (
            <p className="mt-2 text-sm leading-7 text-slate-600">
              {roomType.notes}
            </p>
          )}
          {roomType.amenities.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {roomType.amenities.map((amenity) => (
                <span
                  className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold"
                  key={amenity.id}
                >
                  {amenity.name}
                </span>
              ))}
            </div>
          )}
        </div>
        <div className="flex flex-col justify-end border-t p-5 md:border-r md:border-t-0">
          <p className="text-xs text-slate-400">
            {roomType.displayPrice != null && roomType.displayPrice > 0
              ? "کمترین قیمت روزانه آینده"
              : "قیمت اقامت"}
          </p>
          <p className="mt-1 text-lg font-black text-blue-700">
            {formatPrice(roomType.displayPrice)}
          </p>
          {roomType.availabilityStatus && (
            <p className="mt-2 text-sm font-bold text-slate-700">
              {availabilityLabels[roomType.availabilityStatus] ??
                roomType.availabilityStatus}
            </p>
          )}
          <p className="mt-3 text-xs text-slate-500">
            {roomType.totalInventory === 1
              ? "یک واحد اختصاصی"
              : `${roomType.totalInventory} واحد موجودی`}
          </p>
          <div className="mt-4 grid gap-2">
            <KoochButton className="w-full" onClick={onShowDetails} variant="outline">
              مشاهده جزئیات
            </KoochButton>
            <KoochButton
              aria-pressed={isPreferred}
              className="w-full"
              onClick={onSelect}
            >
              {isPreferred ? "رفتن به پنل رزرو" : "انتخاب این اتاق"}
            </KoochButton>
          </div>
        </div>
      </div>
    </article>
  );
}

function RoomTypeDetailsDialog({
  roomType,
  galleryFallback,
  onOpenChange,
  onSelect,
}: {
  roomType: PublicRoomType | null;
  galleryFallback: string;
  onOpenChange: (open: boolean) => void;
  onSelect: (roomType: PublicRoomType) => void;
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
          <>
            <KoochButton onClick={() => onSelect(roomType)}>
              انتخاب این اتاق
            </KoochButton>
            <KoochButton onClick={() => onOpenChange(false)} variant="outline">
              بستن
            </KoochButton>
          </>
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
              <p>تخت‌ها: {roomType.bedInformation.map(persianBed).join("، ")}</p>
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

function Gallery({
  image,
  name,
  className = "",
  priority = false,
  sizes,
}: {
  image: PublicImage;
  name: string;
  className?: string;
  priority?: boolean;
  sizes: string;
}) {
  return (
    <figure className={`relative h-full w-full ${className}`}>
      <Image
        alt={image.altText || image.caption || name}
        className="object-cover"
        fill
        priority={priority}
        sizes={sizes}
        src={image.url}
        unoptimized={shouldBypassImageOptimization(image.url)}
      />
      {image.caption && (
        <figcaption className="absolute bottom-2 right-2 rounded-lg bg-white/90 px-2 py-1 text-xs font-bold text-slate-700">
          {image.caption}
        </figcaption>
      )}
    </figure>
  );
}

function Badge({
  children,
  green = false,
}: {
  children: React.ReactNode;
  green?: boolean;
}) {
  return (
    <span
      className={`rounded-full px-3 py-1 text-xs font-bold ${
        green ? "bg-green-50 text-green-700" : "bg-blue-50 text-blue-700"
      }`}
    >
      {children}
    </span>
  );
}

function Highlight({ title, value }: { title: string; value: string }) {
  return (
    <article className="rounded-xl border bg-white p-4">
      <p className="text-xs font-bold text-slate-400">{title}</p>
      <p className="mt-2 font-black">{value}</p>
    </article>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-4 rounded-xl border border-dashed bg-white p-6 text-center text-slate-500">
      {children}
    </p>
  );
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
