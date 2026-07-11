"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import { AccommodationSearchBox } from "@/components/AccommodationSearchBox";
import { PromotionCards } from "@/components/promotions/PromotionCards";
import {
  fetchPublicApi,
  formatPrice,
  PublicProperty,
} from "@/lib/public-properties";

type ResultProperty = Pick<
  PublicProperty,
  | "id"
  | "name"
  | "slug"
  | "city"
  | "address"
  | "description"
  | "shortDescription"
  | "coverImageUrl"
  | "startingPrice"
  | "propertyType"
  | "roomTypes"
  | "matchingRoomTypesCount"
  | "matchingRoomTypes"
  | "guestFitStatus"
  | "availabilitySummary"
  | "availabilityStatusSummary"
  | "promotions"
>;

const sampleProperties: ResultProperty[] = [
  {
    id: -1,
    name: "خانه حیاط‌دار کاشان",
    slug: "kashan-courtyard-house",
    city: "کاشان",
    address: "بافت تاریخی کاشان",
    description: "خانه‌ای آرام با اتاق‌های سنتی دور یک حیاط مرکزی.",
    coverImageUrl:
      "https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?auto=format&fit=crop&w=1200&q=80",
    startingPrice: 3000000,
    propertyType: "TraditionalHouse",
    roomTypes: [],
    matchingRoomTypesCount: 1,
    matchingRoomTypes: [],
    guestFitStatus: "مناسب ظرفیت",
    availabilitySummary: "فعلاً همه موجود فرض شده‌اند",
    availabilityStatusSummary: "Unknown",
    shortDescription: "خانه‌ای آرام با اتاق‌های سنتی دور یک حیاط مرکزی.",
  },
  {
    id: -2,
    name: "اقامت بوتیک باغ فین",
    slug: "fin-garden-boutique-stay",
    city: "کاشان",
    address: "جاده فین، کاشان",
    description: "اقامتگاهی ساده و تمیز نزدیک باغ فین و دیدنی‌های تاریخی.",
    coverImageUrl:
      "https://images.unsplash.com/photo-1566073771259-6a8506099945?auto=format&fit=crop&w=1200&q=80",
    startingPrice: 2400000,
    propertyType: "BoutiqueHotel",
    roomTypes: [],
    matchingRoomTypesCount: 1,
    matchingRoomTypes: [],
    guestFitStatus: "مناسب ظرفیت",
    availabilitySummary: "فعلاً همه موجود فرض شده‌اند",
    availabilityStatusSummary: "Unknown",
    shortDescription: "اقامتگاهی ساده و تمیز نزدیک باغ فین و دیدنی‌های تاریخی.",
  },
  {
    id: -3,
    name: "مهمان‌خانه مسیر کویر",
    slug: "desert-road-guesthouse",
    city: "کاشان",
    address: "مسیر آران و بیدگل",
    description: "اقامتی راحت برای شب‌های آرام و سفر کوتاه به کویر.",
    coverImageUrl:
      "https://images.unsplash.com/photo-1542718610-a1d656d1884c?auto=format&fit=crop&w=1200&q=80",
    startingPrice: 2100000,
    propertyType: "EcoLodge",
    roomTypes: [],
    matchingRoomTypesCount: 1,
    matchingRoomTypes: [],
    guestFitStatus: "مناسب ظرفیت",
    availabilitySummary: "فعلاً همه موجود فرض شده‌اند",
    availabilityStatusSummary: "Unknown",
    shortDescription: "اقامتی راحت برای شب‌های آرام و سفر کوتاه به کویر.",
  },
];

const filterGroups = [
  {
    title: "نوع اقامتگاه",
    items: ["خانه سنتی", "هتل بوتیک", "بوم‌گردی", "هتل"],
  },
  {
    title: "امکانات",
    items: ["وای‌فای", "سرویس اختصاصی", "صبحانه", "پارکینگ"],
  },
  { title: "نوع رزرو", items: ["رزرو آنی", "نیازمند تایید"] },
  { title: "نزدیک به", items: ["بازار", "باغ فین", "ایستگاه راه‌آهن"] },
];

const typeLabels: Record<string, string> = {
  TraditionalHouse: "خانه سنتی",
  BoutiqueHotel: "هتل بوتیک",
  EcoLodge: "بوم‌گردی",
  Hotel: "هتل",
  Villa: "ویلا",
  Apartment: "آپارتمان",
};

const availabilityLabels: Record<string, string> = {
  Available: "موجود",
  OnRequest: "نیازمند استعلام",
  Unknown: "نیازمند بررسی",
};

function propertyBadge(type: string) {
  return typeLabels[type] ?? type.replace(/([A-Z])/g, " $1").trim();
}

function isInstantAvailable(property: ResultProperty) {
  return property.availabilityStatusSummary === "Available";
}

function isOnRequest(property: ResultProperty) {
  return property.availabilityStatusSummary === "OnRequest";
}

export default function PropertiesPage() {
  return (
    <Suspense fallback={<PageLoading />}>
      <PropertiesContent />
    </Suspense>
  );
}

function PropertiesContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [properties, setProperties] = useState<ResultProperty[]>([]);
  const [loading, setLoading] = useState(true);
  const [usingSamples, setUsingSamples] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const q = searchParams.get("q") ?? "";
  const city = searchParams.get("city") ?? "Kashan";
  const checkIn = searchParams.get("checkIn") ?? "";
  const checkOut = searchParams.get("checkOut") ?? "";
  const rooms = Number(searchParams.get("rooms") ?? 1);
  const adults = Number(
    searchParams.get("adults") ?? searchParams.get("guests") ?? 2,
  );
  const children = Number(searchParams.get("children") ?? 0);
  const minPrice = searchParams.get("minPrice") ?? "";
  const maxPrice = searchParams.get("maxPrice") ?? "";
  const propertyTypes = searchParams.getAll("propertyType");
  const bookingMode = searchParams.get("bookingMode") ?? "";
  const availability = searchParams.get("availability") ?? "";
  const childAges = (searchParams.get("childAges") ?? "")
    .split(",")
    .filter(Boolean)
    .map((age) => Number(age));

  useEffect(() => {
    const query = new URLSearchParams();
    if (q) query.set("q", q);
    query.set("city", city);
    if (checkIn) query.set("checkIn", checkIn);
    if (checkOut) query.set("checkOut", checkOut);
    query.set("rooms", Math.max(1, rooms).toString());
    query.set("adults", Math.max(1, adults).toString());
    query.set("children", Math.max(0, children).toString());
    if (childAges.length) query.set("childAges", childAges.join(","));

    setLoading(true);
    fetchPublicApi<PublicProperty[]>(`/properties?${query.toString()}`)
      .then((items) => {
        setProperties(items);
        setUsingSamples(false);
      })
      .catch(() => {
        setProperties(sampleProperties);
        setUsingSamples(true);
      })
      .finally(() => setLoading(false));
  }, [
    adults,
    checkIn,
    checkOut,
    children,
    childAges.join(","),
    city,
    q,
    rooms,
  ]);

  const detailQueryText = searchParams.toString();
  const visibleProperties = useMemo(() => {
    const min = minPrice ? Number(minPrice) : null;
    const max = maxPrice ? Number(maxPrice) : null;

    return properties.filter((property) => {
      const price = property.startingPrice ?? 0;
      if (min !== null && Number.isFinite(min) && price < min) return false;
      if (max !== null && Number.isFinite(max) && price > max) return false;
      if (
        propertyTypes.length > 0 &&
        !propertyTypes.includes(property.propertyType)
      )
        return false;
      if (bookingMode === "instant" && !isInstantAvailable(property))
        return false;
      if (bookingMode === "request" && !isOnRequest(property)) return false;
      if (availability && property.availabilityStatusSummary !== availability)
        return false;
      return true;
    });
  }, [
    availability,
    bookingMode,
    maxPrice,
    minPrice,
    properties,
    propertyTypes,
  ]);

  function updateUrlParam(key: string, value: string) {
    const next = new URLSearchParams(searchParams.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    const text = next.toString();
    router.replace(text ? `/properties?${text}` : "/properties", {
      scroll: false,
    });
  }

  function toggleMultiParam(key: string, value: string) {
    const next = new URLSearchParams(searchParams.toString());
    const values = next.getAll(key);
    next.delete(key);
    const nextValues = values.includes(value)
      ? values.filter((item) => item !== value)
      : [...values, value];
    nextValues.forEach((item) => next.append(key, item));
    const text = next.toString();
    router.replace(text ? `/properties?${text}` : "/properties", {
      scroll: false,
    });
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900" dir="rtl">
      <div className="sticky top-16 z-40 border-b border-slate-200 bg-white/95 px-5 py-4 backdrop-blur sm:px-8">
        <AccommodationSearchBox
          className="mx-auto max-w-7xl"
          initialValues={{
            q,
            city,
            checkIn: checkIn || null,
            checkOut: checkOut || null,
            rooms,
            adults,
            children,
            childAges,
          }}
          enableSuggestions
          redirectToResults
          variant="compact"
        />
      </div>

      <main className="mx-auto max-w-7xl px-5 py-8 sm:px-8 sm:py-10">
        <Link className="text-sm font-bold text-blue-700" href="/">
          بازگشت به خانه ←
        </Link>
        <div className="mt-5 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl font-black tracking-tight">
              نتایج جستجو در کاشان
            </h1>
            {q ? (
              <p className="mt-2 text-slate-500">نمایش نتایج برای "{q}"</p>
            ) : (
              <p className="mt-2 text-slate-500">اقامتگاه‌های تاییدشده کاشان</p>
            )}
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm font-semibold text-slate-500">
              {loading
                ? "در حال بارگذاری..."
                : `${visibleProperties.length} اقامتگاه`}
            </span>
            <button
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-bold lg:hidden"
              onClick={() => setFiltersOpen((current) => !current)}
              type="button"
            >
              {filtersOpen ? "بستن فیلترها" : "نمایش فیلترها"}
            </button>
          </div>
        </div>

        {usingSamples && (
          <p className="mt-5 rounded-xl bg-amber-50 p-3 text-sm font-semibold text-amber-800">
            اتصال به API برقرار نشد؛ کارت‌های نمونه نمایش داده شده‌اند.
          </p>
        )}

        <section className="mt-7 rounded-xl border border-slate-200 bg-white p-4">
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <label className="grid gap-2 text-sm font-bold text-slate-700">
              حداقل قیمت
              <input
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                onChange={(event) =>
                  updateUrlParam("minPrice", event.target.value)
                }
                type="number"
                value={minPrice}
              />
            </label>
            <label className="grid gap-2 text-sm font-bold text-slate-700">
              حداکثر قیمت
              <input
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                onChange={(event) =>
                  updateUrlParam("maxPrice", event.target.value)
                }
                type="number"
                value={maxPrice}
              />
            </label>
            <label className="grid gap-2 text-sm font-bold text-slate-700">
              نوع رزرو
              <select
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                onChange={(event) =>
                  updateUrlParam("bookingMode", event.target.value)
                }
                value={bookingMode}
              >
                <option value="">همه</option>
                <option value="instant">رزرو آنی</option>
                <option value="request">نیازمند تایید</option>
              </select>
            </label>
            <label className="grid gap-2 text-sm font-bold text-slate-700">
              موجودی
              <select
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                onChange={(event) =>
                  updateUrlParam("availability", event.target.value)
                }
                value={availability}
              >
                <option value="">همه</option>
                <option value="Available">موجود</option>
                <option value="OnRequest">نیازمند استعلام</option>
                <option value="Unknown">نیازمند بررسی</option>
              </select>
            </label>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            {Object.entries(typeLabels).map(([value, label]) => (
              <label
                className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm font-bold text-slate-600"
                key={value}
              >
                <input
                  checked={propertyTypes.includes(value)}
                  className="h-4 w-4 accent-blue-600"
                  onChange={() => toggleMultiParam("propertyType", value)}
                  type="checkbox"
                />
                {label}
              </label>
            ))}
          </div>
        </section>

        <div className="mt-7 grid gap-7">
          <aside className="hidden">
            <h2 className="text-lg font-black">فیلتر نتایج</h2>
            <fieldset className="mt-5 border-t border-slate-100 pt-5">
              <legend className="font-bold">محدوده قیمت</legend>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <input
                  aria-label="حداقل قیمت"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  placeholder="حداقل"
                  type="number"
                />
                <input
                  aria-label="حداکثر قیمت"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  placeholder="حداکثر"
                  type="number"
                />
              </div>
              <p className="mt-2 text-xs text-slate-400">فعلا نمایشی است</p>
            </fieldset>
            {filterGroups.map((group) => (
              <fieldset
                className="mt-5 border-t border-slate-100 pt-5"
                key={group.title}
              >
                <legend className="font-bold">{group.title}</legend>
                <div className="mt-3 grid gap-3">
                  {group.items.map((item) => (
                    <label
                      className="flex items-center gap-2 text-sm text-slate-600"
                      key={item}
                    >
                      <input
                        className="h-4 w-4 accent-blue-600"
                        type="checkbox"
                      />
                      {item}
                    </label>
                  ))}
                </div>
              </fieldset>
            ))}
          </aside>

          <section>
            {loading ? (
              <PageLoading compact />
            ) : visibleProperties.length === 0 ? (
              <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm font-bold text-slate-600">
                هیچ اقامتگاهی با این شرایط پیدا نشد.
              </div>
            ) : (
              <div className="grid gap-5">
                {visibleProperties.map((property) => {
                  const roomCount =
                    property.matchingRoomTypesCount ||
                    property.roomTypes.length;
                  const detailHref = `/properties/${property.slug}${detailQueryText ? `?${detailQueryText}` : ""}`;

                  return (
                    <article
                      className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm md:grid md:grid-cols-[260px_minmax(0,1fr)_190px]"
                      key={property.id}
                    >
                      <img
                        alt={property.name}
                        className="h-full min-h-52 w-full object-cover"
                        src={
                          property.coverImageUrl ??
                          sampleProperties[0].coverImageUrl!
                        }
                      />
                      <div className="p-5">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-bold text-blue-700">
                            {propertyBadge(property.propertyType)}
                          </span>
                          <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-600">
                            {property.availabilitySummary ||
                              availabilityLabels[
                                property.availabilityStatusSummary
                              ] ||
                              availabilityLabels.Unknown}
                          </span>
                          <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-700">
                            {property.guestFitStatus}
                          </span>
                        </div>
                        <h2 className="mt-3 text-2xl font-black">
                          {property.name}
                        </h2>
                        <p className="mt-1 text-sm font-semibold text-blue-700">
                          {property.city}
                        </p>
                        <p className="mt-1 text-sm text-slate-500">
                          {property.address}
                        </p>
                        <p className="mt-4 line-clamp-3 text-sm leading-6 text-slate-600">
                          {property.shortDescription || property.description}
                        </p>
                        {roomCount > 0 && (
                          <p className="mt-4 text-xs font-semibold text-slate-500">
                            {roomCount} نوع اتاق مناسب جست‌وجوی شما
                          </p>
                        )}
                        {checkIn && checkOut && (
                          <p className="mt-2 text-xs font-semibold text-blue-700">
                            تاریخ انتخاب‌شده برای مرحله بعدی رزرو نگه داشته
                            می‌شود.
                          </p>
                        )}
                        <PromotionCards
                          className="mt-4"
                          compact
                          maxItems={2}
                          promotions={property.promotions}
                        />
                      </div>
                      <div className="flex flex-col items-start justify-end border-t border-slate-100 p-5 md:items-end md:border-l md:border-t-0 md:text-right">
                        <p className="text-xs text-slate-400">قیمت از</p>
                        <p className="mt-1 text-lg font-black text-blue-700">
                          {formatPrice(property.startingPrice)}
                        </p>
                        <Link
                          className="mt-5 w-full rounded-lg bg-blue-600 px-4 py-3 text-center text-sm font-bold text-white hover:bg-blue-700"
                          href={detailHref}
                        >
                          مشاهده اقامتگاه
                        </Link>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}

function PageLoading({ compact = false }: { compact?: boolean }) {
  return (
    <div
      className={`${compact ? "" : "min-h-[60vh] bg-slate-50 px-5 py-12 sm:px-8"}`}
    >
      <div
        className={`${compact ? "" : "mx-auto max-w-7xl"} rounded-xl border border-slate-200 bg-white p-6 text-slate-500`}
      >
        در حال بارگذاری اقامتگاه‌ها...
      </div>
    </div>
  );
}
