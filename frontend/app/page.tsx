"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useRef, useState } from "react";
import { DateRangePicker } from "@/components/DateRangePicker";
import {
  fetchPublicApi,
  formatPrice,
  PublicProperty,
} from "@/lib/public-properties";
import {
  defaultSiteSettings,
  fetchPublicSiteSettings,
  mergeSiteSettings,
  settingValue,
  SiteSettingsMap,
} from "@/lib/site-settings";

type PropertyCardData = Pick<
  PublicProperty,
  | "id"
  | "name"
  | "slug"
  | "city"
  | "description"
  | "coverImageUrl"
  | "startingPrice"
  | "propertyType"
>;

const sampleProperties: PropertyCardData[] = [
  {
    id: -1,
    name: "خانه حیاط دار کاشان",
    slug: "kashan-courtyard-house",
    city: "کاشان",
    description: "اقامتی آرام در خانه ای سنتی با حیاط مرکزی و فضای صمیمی.",
    coverImageUrl:
      "https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?auto=format&fit=crop&w=1200&q=80",
    startingPrice: 3000000,
    propertyType: "TraditionalHouse",
  },
  {
    id: -2,
    name: "اقامت بوتیک باغ فین",
    slug: "fin-garden-boutique-stay",
    city: "کاشان",
    description: "اقامتگاهی ساده و تمیز نزدیک دیدنی های تاریخی کاشان.",
    coverImageUrl:
      "https://images.unsplash.com/photo-1566073771259-6a8506099945?auto=format&fit=crop&w=1200&q=80",
    startingPrice: 2400000,
    propertyType: "BoutiqueHotel",
  },
  {
    id: -3,
    name: "مهمان خانه مسیر کویر",
    slug: "desert-road-guesthouse",
    city: "کاشان",
    description: "پایگاهی راحت برای شب های آرام و سفرهای کوتاه کویری.",
    coverImageUrl:
      "https://images.unsplash.com/photo-1542718610-a1d656d1884c?auto=format&fit=crop&w=1200&q=80",
    startingPrice: 2100000,
    propertyType: "EcoLodge",
  },
];

const typeLabels: Record<string, string> = {
  TraditionalHouse: "خانه سنتی",
  BoutiqueHotel: "بوتیک هتل",
  EcoLodge: "بوم گردی",
  Hotel: "هتل",
  Villa: "ویلا",
  Apartment: "آپارتمان",
};

function badge(type: string) {
  return typeLabels[type] ?? type.replace(/([A-Z])/g, " $1").trim();
}

export default function HomePage() {
  const router = useRouter();
  const guestRef = useRef<HTMLDivElement>(null);
  const [properties, setProperties] = useState<PropertyCardData[]>([]);
  const [loading, setLoading] = useState(true);
  const [usingSamples, setUsingSamples] = useState(false);
  const [settings, setSettings] =
    useState<SiteSettingsMap>(defaultSiteSettings);
  const [city, setCity] = useState("کاشان");
  const [checkIn, setCheckIn] = useState("");
  const [checkOut, setCheckOut] = useState("");
  const [rooms, setRooms] = useState(1);
  const [adults, setAdults] = useState(2);
  const [children, setChildren] = useState(0);
  const [childAges, setChildAges] = useState<number[]>([]);
  const [guestOpen, setGuestOpen] = useState(false);

  const fieldClass =
    "h-[60px] w-full rounded-xl border border-slate-300 bg-white px-4 text-sm font-bold text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-[var(--theme-primary)] focus:ring-2 focus:ring-[var(--theme-primary-border)]";
  const labelClass = "grid gap-2 text-sm font-bold text-slate-700";
  const dateControlClass =
    "flex h-[60px] w-full items-center rounded-xl border bg-white px-4 text-right text-sm transition";

  useEffect(() => {
    fetchPublicSiteSettings()
      .then((items) => setSettings(mergeSiteSettings(items)))
      .catch(() => setSettings(defaultSiteSettings));

    fetchPublicApi<PublicProperty[]>("/properties")
      .then((items) => {
        if (items.length > 0) setProperties(items);
        else {
          setProperties(sampleProperties);
          setUsingSamples(true);
        }
      })
      .catch(() => {
        setProperties(sampleProperties);
        setUsingSamples(true);
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    function onPointerDown(event: PointerEvent) {
      if (!guestRef.current?.contains(event.target as Node)) {
        setGuestOpen(false);
      }
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, []);

  useEffect(() => {
    document.title = settingValue(settings, "site.defaultSeoTitle");
    const description = settingValue(settings, "site.defaultSeoDescription");
    let metaDescription = document.querySelector<HTMLMetaElement>('meta[name="description"]');
    if (!metaDescription) {
      metaDescription = document.createElement("meta");
      metaDescription.name = "description";
      document.head.appendChild(metaDescription);
    }
    metaDescription.content = description;
  }, [settings]);

  function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const query = new URLSearchParams({ city });
    if (checkIn) query.set("checkIn", checkIn);
    if (checkOut) query.set("checkOut", checkOut);
    query.set("rooms", Math.max(1, rooms).toString());
    query.set("adults", Math.max(1, adults).toString());
    query.set("children", Math.max(0, children).toString());
    if (childAges.length > 0) query.set("childAges", childAges.join(","));
    router.push(`/properties?${query.toString()}`);
  }

  function formatFaNumber(value: number) {
    return new Intl.NumberFormat("fa-IR").format(value);
  }

  function updateChildren(nextCount: number) {
    const count = Math.max(0, Math.min(6, nextCount));
    setChildren(count);
    setChildAges((current) => {
      const next = current.slice(0, count);
      while (next.length < count) next.push(5);
      return next;
    });
  }

  function CounterRow({
    title,
    subtitle,
    value,
    min,
    max,
    onChange,
  }: {
    title: string;
    subtitle?: string;
    value: number;
    min: number;
    max?: number;
    onChange: (value: number) => void;
  }) {
    const canDecrease = value > min;
    const canIncrease = max === undefined || value < max;
    return (
      <div className="flex items-center justify-between gap-4 py-3">
        <div>
          <p className="font-black text-slate-950">{title}</p>
          {subtitle && (
            <p className="mt-1 text-xs font-bold text-slate-500">{subtitle}</p>
          )}
        </div>
        <div className="flex items-center gap-3" dir="ltr">
          <button
            className="grid h-8 w-8 place-items-center rounded-full border border-slate-300 text-lg font-black text-[var(--theme-primary)] transition hover:border-[var(--theme-primary)] disabled:cursor-not-allowed disabled:text-slate-300"
            disabled={!canDecrease}
            onClick={() => onChange(value - 1)}
            type="button"
          >
            -
          </button>
          <span className="w-7 text-center text-xl font-black text-slate-950">
            {formatFaNumber(value)}
          </span>
          <button
            className="grid h-8 w-8 place-items-center rounded-full border border-slate-300 text-lg font-black text-[var(--theme-primary)] transition hover:border-[var(--theme-primary)] disabled:cursor-not-allowed disabled:text-slate-300"
            disabled={!canIncrease}
            onClick={() => onChange(value + 1)}
            type="button"
          >
            +
          </button>
        </div>
      </div>
    );
  }

  const guestSummary = `${formatFaNumber(adults)} بزرگسال، ${formatFaNumber(children)} کودک`;
  const roomSummary = `${formatFaNumber(rooms)} اتاق`;
  const heroBackgroundUrl =
    settingValue(settings, "home.heroBackgroundUrl") ||
    defaultSiteSettings["home.heroBackgroundUrl"];

  return (
    <div className="bg-white text-slate-900" dir="rtl">
      <section
        className="relative bg-white px-5 pb-8 sm:px-8 sm:pb-14"
        dir="rtl"
      >
        <div
          className="relative -mx-5 h-[300px] overflow-hidden bg-cover bg-center sm:-mx-8 lg:h-[320px]"
          style={{ backgroundImage: `url(${heroBackgroundUrl})` }}
        >
          <div
            className="absolute inset-0"
            style={{
              background:
                "linear-gradient(180deg, rgb(2 6 23 / 0.68), rgb(15 23 42 / 0.32), color-mix(in srgb, var(--theme-primary) 48%, black))",
            }}
          />
          <div className="relative z-10 mx-auto flex h-full max-w-7xl flex-col items-center justify-center px-5 pt-6 text-center text-white sm:px-8">
            <h1 className="mt-3 text-3xl font-black leading-tight sm:text-5xl">
              {settingValue(settings, "home.heroTitle")}
            </h1>
            <p className="mt-4 max-w-2xl text-sm leading-7 text-blue-50 sm:text-lg">
              {settingValue(settings, "home.heroSubtitle")}
            </p>
          </div>
        </div>

        <form
          className="relative z-10 mx-auto -mt-20 w-full max-w-[860px] rounded-3xl border border-slate-200 bg-[#f5f6fa] p-4 pb-5 shadow-2xl sm:-mt-24 sm:p-6 sm:pb-14"
          onSubmit={search}
        >
          <div className="grid gap-4">
            <label className={labelClass}>
              مقصد
              <input
                className={fieldClass}
                onChange={(event) => setCity(event.target.value)}
                placeholder="کاشان"
                required
                value={city}
              />
            </label>

            <DateRangePicker
              calendarType="jalali"
              controlClassName={dateControlClass}
              disablePastDates
              labelsAbove
              showFieldLabels={false}
              onChange={(nextValue) => {
                setCheckIn(nextValue.startDate ?? "");
                setCheckOut(nextValue.endDate ?? "");
              }}
              placeholderEnd="انتخاب تاریخ"
              placeholderStart="انتخاب تاریخ"
              value={{ startDate: checkIn || null, endDate: checkOut || null }}
            />

            <div className={`${labelClass} relative`} ref={guestRef}>
              مسافران
              <button
                className={`${fieldClass} flex items-center justify-between gap-4 text-right`}
                onClick={() => setGuestOpen((current) => !current)}
                type="button"
              >
                <span className="grid min-w-0 gap-1">
                  <span className="truncate">{guestSummary}</span>
                  <span className="text-xs font-bold text-slate-500">
                    {roomSummary}
                  </span>
                </span>
                <span
                  className={`text-lg text-slate-500 transition ${guestOpen ? "rotate-180" : ""}`}
                >
                  ⌄
                </span>
              </button>
              {guestOpen && (
                <div className="absolute right-0 top-full z-40 mt-3 w-full rounded-2xl border border-slate-200 bg-white p-5 text-right shadow-2xl sm:w-[360px]">
                  <CounterRow
                    title="تعداد اتاق"
                    value={rooms}
                    min={1}
                    onChange={setRooms}
                  />
                  <CounterRow
                    title="بزرگسال"
                    subtitle="۱۸ سال به بالا"
                    value={adults}
                    min={1}
                    onChange={setAdults}
                  />
                  <CounterRow
                    title="کودک"
                    subtitle="۰ تا ۱۷ سال"
                    value={children}
                    min={0}
                    max={6}
                    onChange={updateChildren}
                  />

                  {children > 0 && (
                    <div className="mt-4 border-t border-slate-100 pt-4">
                      <p className="mb-3 text-sm leading-6 text-slate-600">
                        برای محاسبه دقیق، سن کودک را وارد کنید.
                      </p>
                      <div className="grid gap-3">
                        {childAges.map((age, index) => (
                          <label
                            className="grid gap-2 text-sm font-bold text-slate-700"
                            key={index}
                          >
                            سن کودک {formatFaNumber(index + 1)}
                            <select
                              className="h-11 rounded-xl border border-slate-300 bg-white px-3 text-sm font-bold outline-none focus:border-[var(--theme-primary)] focus:ring-2 focus:ring-[var(--theme-primary-border)]"
                              onChange={(event) => {
                                const nextAges = [...childAges];
                                nextAges[index] = Number(event.target.value);
                                setChildAges(nextAges);
                              }}
                              value={age}
                            >
                              {Array.from({ length: 18 }, (_, optionAge) => (
                                <option key={optionAge} value={optionAge}>
                                  {formatFaNumber(optionAge)}
                                </option>
                              ))}
                            </select>
                          </label>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            <button
              className="h-12 w-full rounded-full bg-[var(--theme-primary)] px-8 text-base font-black text-white shadow-lg shadow-blue-600/20 transition hover:bg-[var(--theme-primary-hover)] sm:absolute sm:bottom-[-24px] sm:left-1/2 sm:w-[58%] sm:-translate-x-1/2"
              type="submit"
            >
              {settingValue(settings, "home.searchButtonText")}
            </button>
          </div>
        </form>
      </section>

      <section className="px-5 py-16 sm:px-8 sm:py-20">
        <div className="mx-auto max-w-7xl">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-sm font-bold text-[var(--theme-primary-text)]">
                پیشنهاد کوچ
              </p>
              <h2 className="mt-2 text-3xl font-black tracking-tight">
                {settingValue(settings, "home.popularSectionTitle")}
              </h2>
              <p className="mt-2 text-sm leading-6 text-slate-500">
                {settingValue(settings, "home.popularSectionSubtitle")}
              </p>
            </div>
            {usingSamples && (
              <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-bold text-amber-800">
                نمونه نمایشی
              </span>
            )}
          </div>

          {loading ? (
            <p className="mt-8 rounded-xl bg-slate-50 p-6 text-slate-500">
              در حال بارگذاری اقامتگاه ها...
            </p>
          ) : (
            <div className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {properties.slice(0, 6).map((property) => (
                <article
                  className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition hover:-translate-y-1 hover:shadow-lg"
                  key={property.id}
                >
                  <img
                    alt={property.name}
                    className="aspect-[4/3] w-full object-cover"
                    src={
                      property.coverImageUrl ??
                      sampleProperties[0].coverImageUrl!
                    }
                  />
                  <div className="p-5">
                    <span className="rounded-full bg-[var(--theme-primary-soft)] px-2.5 py-1 text-xs font-bold text-[var(--theme-primary-text)]">
                      {badge(property.propertyType)}
                    </span>
                    <h3 className="mt-3 text-xl font-black">{property.name}</h3>
                    <p className="mt-1 text-sm font-semibold text-slate-500">
                      {property.city}
                    </p>
                    <p className="mt-3 line-clamp-2 min-h-10 text-sm leading-5 text-slate-600">
                      {property.description}
                    </p>
                    <div className="mt-5 flex items-end justify-between gap-3">
                      <div>
                        <p className="text-xs text-slate-400">قیمت از</p>
                        <p className="font-black text-[var(--theme-primary-text)]">
                          {formatPrice(property.startingPrice)}
                        </p>
                      </div>
                      <Link
                        className="rounded-xl border border-[var(--theme-primary)] px-3 py-2 text-sm font-bold text-[var(--theme-primary-text)] hover:bg-[var(--theme-primary-soft)]"
                        href={`/properties/${property.slug}`}
                      >
                        مشاهده
                      </Link>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
