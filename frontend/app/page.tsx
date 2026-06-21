"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AccommodationSearchBox } from "@/components/AccommodationSearchBox";
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
  const [properties, setProperties] = useState<PropertyCardData[]>([]);
  const [loading, setLoading] = useState(true);
  const [usingSamples, setUsingSamples] = useState(false);
  const [settings, setSettings] =
    useState<SiteSettingsMap>(defaultSiteSettings);

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

        <AccommodationSearchBox
          className="-mt-20 sm:-mt-24"
          enableSuggestions
          initialValues={{ city: "Kashan", rooms: 1, adults: 2, children: 0 }}
          redirectToResults
          searchButtonText={settingValue(settings, "home.searchButtonText")}
          variant="hero"
        />
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
