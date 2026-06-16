"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";
import { DateRangePicker } from "@/components/DateRangePicker";
import { fetchPublicApi, formatPrice, PublicProperty } from "@/lib/public-properties";

type PropertyCardData = Pick<PublicProperty, "id" | "name" | "slug" | "city" | "description" | "coverImageUrl" | "startingPrice" | "propertyType">;

const sampleProperties: PropertyCardData[] = [
  { id: -1, name: "خانه حیاط‌دار کاشان", slug: "kashan-courtyard-house", city: "کاشان", description: "اقامتی آرام در خانه‌ای سنتی با حیاط مرکزی.", coverImageUrl: "https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?auto=format&fit=crop&w=1200&q=80", startingPrice: 3000000, propertyType: "TraditionalHouse" },
  { id: -2, name: "اقامت بوتیک باغ فین", slug: "fin-garden-boutique-stay", city: "کاشان", description: "اقامتگاهی ساده و تمیز نزدیک دیدنی‌های تاریخی کاشان.", coverImageUrl: "https://images.unsplash.com/photo-1566073771259-6a8506099945?auto=format&fit=crop&w=1200&q=80", startingPrice: 2400000, propertyType: "BoutiqueHotel" },
  { id: -3, name: "مهمان‌خانه مسیر کویر", slug: "desert-road-guesthouse", city: "کاشان", description: "پایگاهی راحت برای شب‌های آرام و سفرهای کوتاه کویری.", coverImageUrl: "https://images.unsplash.com/photo-1542718610-a1d656d1884c?auto=format&fit=crop&w=1200&q=80", startingPrice: 2100000, propertyType: "EcoLodge" },
];

const categories = [
  ["خانه‌های سنتی", "خانه‌های حیاط‌دار با معماری تاریخی"],
  ["هتل‌های بوتیک", "اقامتگاه‌های کوچک با هویت محلی"],
  ["نزدیک دیدنی‌ها", "اقامت نزدیک بازار، باغ فین و خانه‌های تاریخی"],
  ["سفر کویر", "اقامت مناسب برای برنامه‌های کویری"],
];

const typeLabels: Record<string, string> = {
  TraditionalHouse: "خانه سنتی",
  BoutiqueHotel: "هتل بوتیک",
  EcoLodge: "بوم‌گردی",
  Hotel: "هتل",
  Villa: "ویلا",
  Apartment: "آپارتمان",
};

function badge(type: string) {
  return typeLabels[type] ?? type.replace(/([A-Z])/g, " $1").trim();
}

export default function HomePage() {
  const router = useRouter();
  const [properties, setProperties] = useState<PropertyCardData[]>([]);
  const [loading, setLoading] = useState(true);
  const [usingSamples, setUsingSamples] = useState(false);
  const [city, setCity] = useState("کاشان");
  const [checkIn, setCheckIn] = useState("");
  const [checkOut, setCheckOut] = useState("");
  const [guests, setGuests] = useState(2);

  useEffect(() => {
    fetchPublicApi<PublicProperty[]>("/properties")
      .then((items) => {
        if (items.length > 0) setProperties(items);
        else { setProperties(sampleProperties); setUsingSamples(true); }
      })
      .catch(() => { setProperties(sampleProperties); setUsingSamples(true); })
      .finally(() => setLoading(false));
  }, []);

  function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const query = new URLSearchParams({ city });
    if (checkIn) query.set("checkIn", checkIn);
    if (checkOut) query.set("checkOut", checkOut);
    query.set("guests", guests.toString());
    router.push(`/properties?${query.toString()}`);
  }

  return (
    <div className="bg-white text-slate-900" dir="rtl">
      <section className="border-b border-slate-200 bg-white px-5 py-14 sm:px-8 sm:py-20">
        <div className="mx-auto max-w-7xl">
          <div className="max-w-3xl">
            <p className="text-sm font-bold text-blue-700">سفر محلی با کوچ</p>
            <h1 className="mt-4 text-4xl font-black leading-tight text-slate-950 sm:text-6xl">اقامتگاه مناسب خود را در کاشان پیدا کنید</h1>
            <p className="mt-5 text-base leading-8 text-slate-600 sm:text-lg">خانه‌های سنتی، هتل‌های بوتیک و اقامتگاه‌های محلی را ساده و شفاف بررسی کنید.</p>
          </div>
        </div>
      </section>

      <div className="relative z-10 mx-auto -mt-8 max-w-6xl px-5 sm:px-8">
        <form className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-lg md:grid-cols-[1.2fr_2fr_0.7fr_auto] md:items-end" onSubmit={search}>
          <label className="grid gap-1 text-sm font-bold text-slate-700">مقصد یا شهر<input className="rounded-xl border border-slate-300 px-4 py-3 font-normal" onChange={(event) => setCity(event.target.value)} required value={city} /></label>
          <div>
            <DateRangePicker
              calendarType="jalali"
              disablePastDates
              onChange={(nextValue) => {
                setCheckIn(nextValue.startDate ?? "");
                setCheckOut(nextValue.endDate ?? "");
              }}
              placeholderEnd="تاریخ برگشت"
              placeholderStart="تاریخ رفت"
              value={{ startDate: checkIn || null, endDate: checkOut || null }}
            />
          </div>
          <label className="grid gap-1 text-sm font-bold text-slate-700">مهمان<input className="rounded-xl border border-slate-300 px-4 py-3 font-normal" min="1" onChange={(event) => setGuests(Number(event.target.value))} type="number" value={guests} /></label>
          <button className="rounded-xl bg-blue-600 px-7 py-3 font-black text-white transition hover:bg-blue-700" type="submit">جست‌وجو</button>
        </form>
      </div>

      <section className="px-5 py-16 sm:px-8 sm:py-20">
        <div className="mx-auto max-w-7xl">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div><p className="text-sm font-bold text-blue-600">پیشنهاد کوچ</p><h2 className="mt-2 text-3xl font-black tracking-tight">اقامتگاه‌های محبوب</h2></div>
            {usingSamples && <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-bold text-amber-800">نمونه نمایشی</span>}
          </div>
          {loading ? <p className="mt-8 rounded-xl bg-slate-50 p-6 text-slate-500">در حال بارگذاری اقامتگاه‌ها...</p> : <div className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">{properties.slice(0, 6).map((property) => <article className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition hover:-translate-y-1 hover:shadow-lg" key={property.id}><img alt={property.name} className="aspect-[4/3] w-full object-cover" src={property.coverImageUrl ?? sampleProperties[0].coverImageUrl!} /><div className="p-5"><span className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-bold text-blue-700">{badge(property.propertyType)}</span><h3 className="mt-3 text-xl font-black">{property.name}</h3><p className="mt-1 text-sm font-semibold text-slate-500">{property.city}</p><p className="mt-3 line-clamp-2 min-h-10 text-sm leading-5 text-slate-600">{property.description}</p><div className="mt-5 flex items-end justify-between gap-3"><div><p className="text-xs text-slate-400">قیمت از</p><p className="font-black text-blue-700">{formatPrice(property.startingPrice)}</p></div><Link className="rounded-lg border border-blue-600 px-3 py-2 text-sm font-bold text-blue-700 hover:bg-blue-50" href={`/properties/${property.slug}`}>مشاهده</Link></div></div></article>)}</div>}
        </div>
      </section>

      <section className="bg-slate-50 px-5 py-16 sm:px-8">
        <div className="mx-auto max-w-7xl"><h2 className="text-3xl font-black tracking-tight">دسته‌بندی‌های پرکاربرد</h2><div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{categories.map(([title, description], index) => <Link className="rounded-2xl border border-slate-200 bg-white p-5 transition hover:border-blue-300 hover:shadow-md" href={`/properties?category=${encodeURIComponent(title)}`} key={title}><div className="grid h-10 w-10 place-items-center rounded-xl bg-blue-50 font-black text-blue-700">{index + 1}</div><h3 className="mt-5 text-lg font-black">{title}</h3><p className="mt-2 text-sm leading-6 text-slate-500">{description}</p></Link>)}</div></div>
      </section>
    </div>
  );
}
