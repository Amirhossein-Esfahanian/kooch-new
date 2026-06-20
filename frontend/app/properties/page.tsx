"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent, Suspense, useEffect, useState } from "react";
import { SharedDateRangePicker } from "@/components/SharedDateRangePicker";
import { fetchPublicApi, formatPrice, PublicProperty } from "@/lib/public-properties";

type ResultProperty = Pick<
  PublicProperty,
  | "id"
  | "name"
  | "slug"
  | "city"
  | "address"
  | "description"
  | "coverImageUrl"
  | "startingPrice"
  | "propertyType"
  | "roomTypes"
  | "matchingRoomTypesCount"
  | "availabilityStatusSummary"
>;

const sampleProperties: ResultProperty[] = [
  {
    id: -1,
    name: "خانه حیاط‌دار کاشان",
    slug: "kashan-courtyard-house",
    city: "کاشان",
    address: "بافت تاریخی کاشان",
    description: "خانه‌ای آرام با اتاق‌های سنتی دور یک حیاط مرکزی.",
    coverImageUrl: "https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?auto=format&fit=crop&w=1200&q=80",
    startingPrice: 3000000,
    propertyType: "TraditionalHouse",
    roomTypes: [],
    matchingRoomTypesCount: 1,
    availabilityStatusSummary: "Unknown",
  },
  {
    id: -2,
    name: "اقامت بوتیک باغ فین",
    slug: "fin-garden-boutique-stay",
    city: "کاشان",
    address: "جاده فین، کاشان",
    description: "اقامتگاهی ساده و تمیز نزدیک باغ فین و دیدنی‌های تاریخی.",
    coverImageUrl: "https://images.unsplash.com/photo-1566073771259-6a8506099945?auto=format&fit=crop&w=1200&q=80",
    startingPrice: 2400000,
    propertyType: "BoutiqueHotel",
    roomTypes: [],
    matchingRoomTypesCount: 1,
    availabilityStatusSummary: "Unknown",
  },
  {
    id: -3,
    name: "مهمان‌خانه مسیر کویر",
    slug: "desert-road-guesthouse",
    city: "کاشان",
    address: "مسیر آران و بیدگل",
    description: "اقامتی راحت برای شب‌های آرام و سفر کوتاه به کویر.",
    coverImageUrl: "https://images.unsplash.com/photo-1542718610-a1d656d1884c?auto=format&fit=crop&w=1200&q=80",
    startingPrice: 2100000,
    propertyType: "EcoLodge",
    roomTypes: [],
    matchingRoomTypesCount: 1,
    availabilityStatusSummary: "Unknown",
  },
];

const filterGroups = [
  { title: "نوع اقامتگاه", items: ["خانه سنتی", "هتل بوتیک", "بوم‌گردی", "هتل"] },
  { title: "امکانات", items: ["وای‌فای", "سرویس اختصاصی", "صبحانه", "پارکینگ"] },
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
  const [city, setCity] = useState(searchParams.get("city") ?? "کاشان");
  const [checkIn, setCheckIn] = useState(searchParams.get("checkIn") ?? "");
  const [checkOut, setCheckOut] = useState(searchParams.get("checkOut") ?? "");
  const [adults, setAdults] = useState(Number(searchParams.get("adults") ?? searchParams.get("guests") ?? 2));
  const [children, setChildren] = useState(Number(searchParams.get("children") ?? 0));
  const [properties, setProperties] = useState<ResultProperty[]>([]);
  const [loading, setLoading] = useState(true);
  const [usingSamples, setUsingSamples] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);

  useEffect(() => {
    const query = new URLSearchParams();
    if (city) query.set("city", city);
    if (checkIn) query.set("checkIn", checkIn);
    if (checkOut) query.set("checkOut", checkOut);
    query.set("adults", Math.max(1, adults).toString());
    query.set("children", Math.max(0, children).toString());

    setLoading(true);
    fetchPublicApi<PublicProperty[]>(`/properties?${query.toString()}`)
      .then((items) => {
        if (items.length > 0) {
          setProperties(items);
          setUsingSamples(false);
        } else {
          setProperties(sampleProperties);
          setUsingSamples(true);
        }
      })
      .catch(() => {
        setProperties(sampleProperties);
        setUsingSamples(true);
      })
      .finally(() => setLoading(false));
  }, [adults, checkIn, checkOut, children, city]);

  function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const query = new URLSearchParams({
      city,
      adults: Math.max(1, adults).toString(),
      children: Math.max(0, children).toString(),
    });
    if (checkIn) query.set("checkIn", checkIn);
    if (checkOut) query.set("checkOut", checkOut);
    router.push(`/properties?${query.toString()}`);
  }

  const detailQuery = new URLSearchParams();
  if (checkIn) detailQuery.set("checkIn", checkIn);
  if (checkOut) detailQuery.set("checkOut", checkOut);
  detailQuery.set("adults", Math.max(1, adults).toString());
  detailQuery.set("children", Math.max(0, children).toString());
  const detailQueryText = detailQuery.toString();

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900" dir="rtl">
      <div className="sticky top-16 z-40 border-b border-slate-200 bg-white/95 px-5 py-4 backdrop-blur sm:px-8">
        <form className="mx-auto grid max-w-7xl gap-3 md:grid-cols-[1.1fr_1.7fr_0.65fr_0.65fr_auto] md:items-end" onSubmit={search}>
          <label className="grid gap-1 text-xs font-bold text-slate-600">
            مقصد یا شهر
            <input
              className="rounded-lg border border-slate-300 px-3 py-2.5 text-sm font-normal"
              onChange={(event) => setCity(event.target.value)}
              required
              value={city}
            />
          </label>
          <div>
            <SharedDateRangePicker
              calendarType="jalali"
              disablePastDates
              onChange={(nextValue) => {
                setCheckIn(nextValue.startDate ?? "");
                setCheckOut(nextValue.endDate ?? "");
              }}
              placeholderEnd="تاریخ خروج"
              placeholderStart="تاریخ ورود"
              value={{ startDate: checkIn || null, endDate: checkOut || null }}
            />
          </div>
          <label className="grid gap-1 text-xs font-bold text-slate-600">
            بزرگسال
            <input
              className="rounded-lg border border-slate-300 px-3 py-2.5 text-sm font-normal"
              min="1"
              onChange={(event) => setAdults(Number(event.target.value))}
              type="number"
              value={adults}
            />
          </label>
          <label className="grid gap-1 text-xs font-bold text-slate-600">
            کودک
            <input
              className="rounded-lg border border-slate-300 px-3 py-2.5 text-sm font-normal"
              min="0"
              onChange={(event) => setChildren(Number(event.target.value))}
              type="number"
              value={children}
            />
          </label>
          <button className="rounded-lg bg-blue-600 px-6 py-2.5 font-bold text-white hover:bg-blue-700" type="submit">
            جست‌وجو
          </button>
        </form>
      </div>

      <main className="mx-auto max-w-7xl px-5 py-8 sm:px-8 sm:py-10">
        <Link className="text-sm font-bold text-blue-700" href="/">
          بازگشت به خانه ←
        </Link>
        <div className="mt-5 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl font-black tracking-tight">اقامتگاه‌های {city || "کاشان"}</h1>
            <p className="mt-2 text-slate-500">خانه‌های سنتی و هتل‌های بوتیک تاییدشده</p>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm font-semibold text-slate-500">
              {loading ? "در حال بارگذاری..." : `${properties.length} اقامتگاه`}
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
            اقامتگاه تاییدشده‌ای از API دریافت نشد؛ کارت‌های نمونه نمایش داده شده‌اند.
          </p>
        )}

        <div className="mt-7 grid gap-7 lg:grid-cols-[260px_minmax(0,1fr)]">
          <aside className={`${filtersOpen ? "block" : "hidden"} h-fit rounded-xl border border-slate-200 bg-white p-5 lg:sticky lg:top-40 lg:block`}>
            <h2 className="text-lg font-black">فیلتر نتایج</h2>
            <fieldset className="mt-5 border-t border-slate-100 pt-5">
              <legend className="font-bold">محدوده قیمت</legend>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <input aria-label="حداقل قیمت" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder="حداقل" type="number" />
                <input aria-label="حداکثر قیمت" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder="حداکثر" type="number" />
              </div>
              <p className="mt-2 text-xs text-slate-400">فعلا نمایشی است</p>
            </fieldset>
            {filterGroups.map((group) => (
              <fieldset className="mt-5 border-t border-slate-100 pt-5" key={group.title}>
                <legend className="font-bold">{group.title}</legend>
                <div className="mt-3 grid gap-3">
                  {group.items.map((item) => (
                    <label className="flex items-center gap-2 text-sm text-slate-600" key={item}>
                      <input className="h-4 w-4 accent-blue-600" type="checkbox" />
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
            ) : (
              <div className="grid gap-5">
                {properties.map((property) => {
                  const roomCount = property.matchingRoomTypesCount || property.roomTypes.length;
                  const detailHref = `/properties/${property.slug}${detailQueryText ? `?${detailQueryText}` : ""}`;

                  return (
                    <article
                      className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm md:grid md:grid-cols-[260px_minmax(0,1fr)_190px]"
                      key={property.id}
                    >
                      <img
                        alt={property.name}
                        className="h-full min-h-52 w-full object-cover"
                        src={property.coverImageUrl ?? sampleProperties[0].coverImageUrl!}
                      />
                      <div className="p-5">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-bold text-blue-700">
                            {propertyBadge(property.propertyType)}
                          </span>
                          <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-600">
                            {availabilityLabels[property.availabilityStatusSummary] ?? availabilityLabels.Unknown}
                          </span>
                        </div>
                        <h2 className="mt-3 text-2xl font-black">{property.name}</h2>
                        <p className="mt-1 text-sm font-semibold text-blue-700">{property.city}</p>
                        <p className="mt-1 text-sm text-slate-500">{property.address}</p>
                        <p className="mt-4 line-clamp-3 text-sm leading-6 text-slate-600">{property.description}</p>
                        {roomCount > 0 && (
                          <p className="mt-4 text-xs font-semibold text-slate-500">
                            {roomCount} نوع اتاق مناسب جست‌وجوی شما · قیمت فعلی یا پایه نمایش داده شده است
                          </p>
                        )}
                      </div>
                      <div className="flex flex-col items-start justify-end border-t border-slate-100 p-5 md:items-end md:border-l md:border-t-0 md:text-right">
                        <p className="text-xs text-slate-400">قیمت از</p>
                        <p className="mt-1 text-lg font-black text-blue-700">{formatPrice(property.startingPrice)}</p>
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
    <div className={`${compact ? "" : "min-h-[60vh] bg-slate-50 px-5 py-12 sm:px-8"}`}>
      <div className={`${compact ? "" : "mx-auto max-w-7xl"} rounded-xl border border-slate-200 bg-white p-6 text-slate-500`}>
        در حال بارگذاری اقامتگاه‌ها...
      </div>
    </div>
  );
}
