"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";
import { fetchPublicApi, formatPrice, PublicProperty } from "@/lib/public-properties";

type PropertyCardData = Pick<PublicProperty, "id" | "name" | "slug" | "city" | "description" | "coverImageUrl" | "startingPrice" | "propertyType">;

const sampleProperties: PropertyCardData[] = [
  { id: -1, name: "Kashan Courtyard House", slug: "kashan-courtyard-house", city: "Kashan", description: "A peaceful traditional house with rooms around a central courtyard.", coverImageUrl: "https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?auto=format&fit=crop&w=1200&q=80", startingPrice: 3000000, propertyType: "TraditionalHouse" },
  { id: -2, name: "Fin Garden Boutique Stay", slug: "fin-garden-boutique-stay", city: "Kashan", description: "A simple boutique stay near Kashan's historic gardens and houses.", coverImageUrl: "https://images.unsplash.com/photo-1566073771259-6a8506099945?auto=format&fit=crop&w=1200&q=80", startingPrice: 2400000, propertyType: "BoutiqueHotel" },
  { id: -3, name: "Desert Road Guesthouse", slug: "desert-road-guesthouse", city: "Kashan", description: "A comfortable local base for quiet evenings and nearby desert trips.", coverImageUrl: "https://images.unsplash.com/photo-1542718610-a1d656d1884c?auto=format&fit=crop&w=1200&q=80", startingPrice: 2100000, propertyType: "EcoLodge" },
];

const categories = [
  ["خانه‌های سنتی", "خانه‌های حیاط‌دار با معماری تاریخی"],
  ["هتل‌های بوتیک", "اقامتگاه‌های کوچک با هویت محلی"],
  ["نزدیک خانه‌های تاریخی", "اقامت در نزدیکی دیدنی‌های مشهور کاشان"],
  ["اقامت برای سفر کویر", "پایگاهی مناسب برای گردش‌های کویری"],
];

function badge(type: string) {
  if (type === "TraditionalHouse") return "اقامتگاه سنتی";
  if (type === "BoutiqueHotel") return "هتل بوتیک";
  return type.replace(/([A-Z])/g, " $1").trim();
}

export default function HomePage() {
  const router = useRouter();
  const [properties, setProperties] = useState<PropertyCardData[]>([]);
  const [loading, setLoading] = useState(true);
  const [usingSamples, setUsingSamples] = useState(false);
  const [city, setCity] = useState("Kashan");
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
      <section className="bg-gradient-to-br from-blue-700 via-blue-600 to-cyan-500 px-5 pb-28 pt-16 text-white sm:px-8 sm:pb-32 sm:pt-20">
        <div className="mx-auto max-w-7xl text-center">
          <p className="text-sm font-bold text-blue-100">سفر محلی با کوچ</p>
          <h1 className="mx-auto mt-4 max-w-4xl text-4xl font-black tracking-tight sm:text-6xl">اقامتگاه‌های سنتی کاشان را پیدا کنید</h1>
          <p className="mx-auto mt-5 max-w-2xl text-base leading-7 text-blue-50 sm:text-lg">خانه‌های بوتیک، اتاق‌های سنتی و اقامتگاه‌های محلی را با اطمینان انتخاب کنید.</p>
        </div>
      </section>

      <div className="relative z-10 mx-auto -mt-16 max-w-6xl px-5 sm:px-8">
        <form className="grid gap-3 rounded-2xl bg-white p-4 shadow-[0_16px_45px_rgba(15,23,42,0.18)] md:grid-cols-[1.3fr_1fr_1fr_0.7fr_auto] md:items-end" onSubmit={search}>
          <label className="grid gap-1 text-sm font-bold text-slate-700">مقصد یا شهر<input className="rounded-xl border border-slate-300 px-4 py-3 font-normal outline-none focus:border-blue-500" onChange={(event) => setCity(event.target.value)} required value={city} /></label>
          <label className="grid gap-1 text-sm font-bold text-slate-700">تاریخ ورود<input className="rounded-xl border border-slate-300 px-4 py-3 font-normal outline-none focus:border-blue-500" onChange={(event) => setCheckIn(event.target.value)} type="date" value={checkIn} /></label>
          <label className="grid gap-1 text-sm font-bold text-slate-700">تاریخ خروج<input className="rounded-xl border border-slate-300 px-4 py-3 font-normal outline-none focus:border-blue-500" min={checkIn} onChange={(event) => setCheckOut(event.target.value)} type="date" value={checkOut} /></label>
          <label className="grid gap-1 text-sm font-bold text-slate-700">مهمان<input className="rounded-xl border border-slate-300 px-4 py-3 font-normal outline-none focus:border-blue-500" min="1" onChange={(event) => setGuests(Number(event.target.value))} type="number" value={guests} /></label>
          <button className="rounded-xl bg-blue-600 px-7 py-3 font-black text-white transition hover:bg-blue-700" type="submit">جست‌وجو</button>
        </form>
      </div>

      <section className="px-5 py-16 sm:px-8 sm:py-20">
        <div className="mx-auto max-w-7xl">
          <div className="flex flex-wrap items-end justify-between gap-3"><div><p className="text-sm font-bold text-blue-600">پیشنهاد کوچ</p><h2 className="mt-2 text-3xl font-black tracking-tight">اقامتگاه‌های محبوب کاشان</h2></div>{usingSamples && <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-bold text-amber-800">نمونه نمایشی</span>}</div>
          {loading ? <p className="mt-8 rounded-xl bg-slate-50 p-6 text-slate-500">در حال بارگذاری اقامتگاه‌ها...</p> : <div className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">{properties.slice(0, 6).map((property) => <article className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition hover:-translate-y-1 hover:shadow-lg" key={property.id}><img alt={property.name} className="aspect-[4/3] w-full object-cover" src={property.coverImageUrl ?? sampleProperties[0].coverImageUrl!} /><div className="p-5"><span className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-bold text-blue-700">{badge(property.propertyType)}</span><h3 className="mt-3 text-xl font-black">{property.name}</h3><p className="mt-1 text-sm font-semibold text-slate-500">{property.city}</p><p className="mt-3 line-clamp-2 min-h-10 text-sm leading-5 text-slate-600">{property.description}</p><div className="mt-5 flex items-end justify-between gap-3"><div><p className="text-xs text-slate-400">قیمت از</p><p className="font-black text-blue-700">{formatPrice(property.startingPrice)}</p></div><Link className="rounded-lg border border-blue-600 px-3 py-2 text-sm font-bold text-blue-700" href={`/properties/${property.slug}`}>مشاهده اقامتگاه</Link></div></div></article>)}</div>}
        </div>
      </section>

      <section className="bg-slate-50 px-5 py-16 sm:px-8">
        <div className="mx-auto max-w-7xl"><h2 className="text-3xl font-black tracking-tight">Explore Kashan your way</h2><div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{categories.map(([title, description], index) => <Link className="rounded-2xl border border-slate-200 bg-white p-5 transition hover:border-blue-300 hover:shadow-md" href={`/properties?category=${encodeURIComponent(title)}`} key={title}><div className="grid h-10 w-10 place-items-center rounded-xl bg-blue-50 font-black text-blue-700">{index + 1}</div><h3 className="mt-5 text-lg font-black">{title}</h3><p className="mt-2 text-sm leading-6 text-slate-500">{description}</p></Link>)}</div></div>
      </section>
    </div>
  );
}
