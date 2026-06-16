"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { fetchPublicApi, formatPrice, PublicImage, PublicProperty, PublicRoom } from "@/lib/public-properties";

const placeholder = "https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?auto=format&fit=crop&w=1200&q=80";

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
  CourtyardView: "Courtyard View",
  GardenView: "Garden View",
  CityView: "City View",
  MountainView: "Mountain View",
  DesertView: "Desert View",
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

export default function PublicPropertyPage() {
  const { slug } = useParams<{ slug: string }>();
  const [property, setProperty] = useState<PublicProperty | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!slug) return;
    fetchPublicApi<PublicProperty>(`/properties/${encodeURIComponent(slug)}`)
      .then(setProperty)
      .catch((caught: Error) => setError(caught.message))
      .finally(() => setLoading(false));
  }, [slug]);

  const groupedAmenities = useMemo(() => {
    const groups = new Map<string, PublicProperty["amenities"]>();
    for (const amenity of property?.amenities ?? []) groups.set(amenity.category, [...(groups.get(amenity.category) ?? []), amenity]);
    return [...groups.entries()];
  }, [property]);

  if (loading) return <PageMessage>در حال بارگذاری اقامتگاه...</PageMessage>;
  if (error || !property) return <PageMessage error="اقامتگاه پیدا نشد." />;

  const gallery = property.images.length ? property.images : [{ id: -1, url: placeholder, altText: property.name, caption: null, tag: null, isCover: true }];
  const descriptions = property.descriptionSections.length ? property.descriptionSections : [{ sectionType: "PropertyIntroduction" as const, title: "", content: property.description, sortOrder: 0 }];
  const accessibility = [
    ["مناسب ویلچر", property.isWheelchairAccessible],
    ["آسانسور", property.hasElevator],
    ["اتاق همکف", property.hasGroundFloorRoom],
    ["سرویس مناسب افراد کم‌توان", property.hasAccessibleBathroom],
  ].filter(([, value]) => value !== null);

  return <div className="bg-slate-50 px-5 py-8 text-slate-900 sm:px-8" dir="rtl">
    <div className="mx-auto max-w-7xl">
      <Link className="text-sm font-bold text-blue-700" href="/properties">بازگشت به نتایج جست‌وجو ←</Link>
      <header className="mt-5 flex flex-wrap items-start justify-between gap-5"><div><div className="flex gap-2"><Badge>{propertyTypeLabels[property.propertyType] ?? property.propertyType}</Badge><Badge green>تأییدشده</Badge></div><h1 className="mt-3 text-3xl font-black sm:text-5xl">{property.name}</h1>{property.englishName && <p className="mt-2 text-sm text-slate-400" dir="ltr">{property.englishName}</p>}<p className="mt-3 text-slate-600">{property.address}، {property.city}</p></div><div className="rounded-xl border bg-white px-4 py-3 shadow-sm"><strong className="text-blue-700">اقامتگاه جدید</strong><p className="mt-1 text-xs text-slate-400">ثبت نظر به‌زودی فعال می‌شود</p></div></header>

      <section className="relative mt-7 grid h-[430px] grid-cols-2 grid-rows-2 gap-2 overflow-hidden rounded-2xl md:grid-cols-4"><Gallery image={gallery[0]} className="col-span-2 row-span-2" name={property.name} />{[1,2,3,4].map((index) => <Gallery image={gallery[index] ?? gallery[0]} className={index > 2 ? "hidden md:block" : ""} key={index} name={property.name} />)}<button className="absolute bottom-4 left-4 rounded-lg bg-white px-4 py-2 text-sm font-bold shadow-lg" type="button">مشاهده همه تصاویر ({property.images.length})</button></section>

      <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,1fr)_330px]">
        <div className="grid gap-8">
          <section><h2 className="text-2xl font-black">اطلاعات سریع</h2><div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3"><Highlight title="ساعت ورود" value={property.checkInTime?.slice(0,5) ?? "ثبت نشده"} /><Highlight title="ساعت خروج" value={property.checkOutTime?.slice(0,5) ?? "ثبت نشده"} /><Highlight title="نوع اقامتگاه" value={propertyTypeLabels[property.propertyType] ?? property.propertyType} /><Highlight title="نوع رزرو" value={property.isInstantBooking ? "رزرو آنی" : "نیازمند تأیید میزبان"} /></div></section>
          <section className="rounded-2xl bg-white p-6 shadow-sm"><h2 className="text-2xl font-black">درباره اقامتگاه</h2><div className="mt-5 grid gap-6">{descriptions.map((section) => <article key={section.sectionType}><h3 className="text-lg font-bold">{section.title || sectionLabels[section.sectionType]}</h3><p className="mt-2 whitespace-pre-line leading-8 text-slate-600">{section.content}</p></article>)}</div></section>
          {property.commonAreas.length > 0 && <section><h2 className="text-2xl font-black">فضاهای مشترک</h2><div className="mt-5 grid gap-3 sm:grid-cols-2">{property.commonAreas.map((area) => <article className="rounded-xl border bg-white p-5" key={area.id}><h3 className="font-black">{area.name}</h3>{area.description && <p className="mt-2 text-sm leading-7 text-slate-600">{area.description}</p>}</article>)}</div></section>}
          {property.views.length > 0 && <section><h2 className="text-2xl font-black">چشم‌اندازها</h2><div className="mt-4 flex flex-wrap gap-2">{property.views.map((view) => <span className="rounded-full border bg-white px-3 py-1.5 text-sm font-bold" key={view}>{viewLabels[view] ?? view}</span>)}</div></section>}
          {accessibility.length > 0 && <section><h2 className="text-2xl font-black">دسترسی‌پذیری</h2><div className="mt-4 grid gap-3 sm:grid-cols-2">{accessibility.map(([label, value]) => <article className="rounded-xl border bg-white p-4" key={String(label)}><p className="text-sm font-bold text-slate-500">{label}</p><p className={`mt-2 font-black ${value ? "text-green-700" : "text-slate-500"}`}>{value ? "دارد" : "ندارد"}</p></article>)}</div></section>}
          <section><h2 className="text-2xl font-black">امکانات</h2>{groupedAmenities.length ? <div className="mt-5 grid gap-4 sm:grid-cols-2">{groupedAmenities.map(([category, amenities]) => <article className="rounded-xl border bg-white p-5" key={category}><h3 className="font-black">{category}</h3><div className="mt-3 flex flex-wrap gap-2">{amenities.map((amenity) => <span className="rounded-full bg-slate-100 px-3 py-1.5 text-sm font-semibold" key={amenity.id}>{amenity.name}</span>)}</div></article>)}</div> : <Empty>هنوز امکاناتی ثبت نشده است.</Empty>}</section>
          <section><h2 className="text-2xl font-black">انتخاب اتاق</h2><div className="mt-5 grid gap-5">{property.roomTypes.length ? property.roomTypes.map((roomType) => <article className="overflow-hidden rounded-2xl border bg-white shadow-sm" key={roomType.id}><div className="grid md:grid-cols-[220px_minmax(0,1fr)_190px]"><img alt={roomType.name} className="h-full min-h-52 w-full object-cover" src={roomType.images[0]?.url ?? gallery[0].url} /><div className="p-5"><h3 className="text-xl font-black">{roomType.name}</h3>{roomType.englishName && <p className="mt-1 text-xs text-slate-400" dir="ltr">{roomType.englishName}</p>}<p className="mt-3 text-sm font-semibold text-slate-700">{roomType.maxAdults + roomType.maxChildren} نفر | {roomType.bedInformation.map(persianBed).join(" | ") || "ترکیب تخت ثبت نشده"}</p><p className="mt-3 text-sm leading-7 text-slate-600">{roomType.description}</p>{roomType.namedRooms.map((room) => <RoomNotes key={room.id} room={room} />)}</div><div className="flex flex-col justify-end border-t p-5 md:border-r md:border-t-0"><p className="text-xs text-slate-400">قیمت از</p><p className="mt-1 text-lg font-black text-blue-700">{formatPrice(roomType.displayPrice)}</p><p className="mt-3 text-xs text-slate-500">{roomType.inventoryMode === "NamedRooms" ? "اتاق نام‌دار" : `${roomType.totalInventory} واحد موجودی`}</p></div></div></article>) : <Empty>هنوز اتاق فعالی ثبت نشده است.</Empty>}</div></section>
          {property.inventoryMode === "NamedRooms" && <section><h2 className="text-2xl font-black">اتاق‌های نام‌دار</h2><div className="mt-5 grid gap-4 sm:grid-cols-2">{property.roomTypes.flatMap((type) => type.namedRooms).map((room) => <article className="overflow-hidden rounded-xl border bg-white" key={room.id}>{room.images[0] && <img alt={room.name} className="aspect-[16/8] w-full object-cover" src={room.images[0].url} />}<div className="p-5"><h3 className="text-lg font-black">{room.name}</h3><RoomNotes room={room} /></div></article>)}</div></section>}
          <section><h2 className="text-2xl font-black">مکان‌های نزدیک</h2>{property.nearbyPlaces.length ? <div className="mt-5 overflow-x-auto rounded-xl border bg-white"><table className="w-full min-w-[520px] text-sm"><thead className="bg-slate-100 text-slate-500"><tr><th className="p-3 text-right">مکان</th><th className="p-3 text-right">پیاده</th><th className="p-3 text-right">با خودرو</th></tr></thead><tbody>{property.nearbyPlaces.map((place) => <tr className="border-t" key={place.id}><td className="p-3 font-bold">{place.title}</td><td className="p-3">{place.walkingMinutes != null ? `${place.walkingMinutes} دقیقه` : "-"}</td><td className="p-3">{place.drivingMinutes != null ? `${place.drivingMinutes} دقیقه` : "-"}</td></tr>)}</tbody></table></div> : <Empty>مکان نزدیکی ثبت نشده است.</Empty>}</section>
          <section><h2 className="text-2xl font-black">موقعیت</h2><div className="mt-4 grid min-h-64 place-items-center rounded-2xl border border-dashed border-blue-300 bg-blue-50 text-center"><div><strong className="text-blue-800">نقشه به‌زودی اضافه می‌شود</strong><p className="mt-2 text-sm text-blue-700">{property.city}</p></div></div></section>
        </div>
        <aside className="h-fit rounded-2xl border bg-white p-5 shadow-lg lg:sticky lg:top-24"><p className="text-sm text-slate-500">قیمت از</p><p className="mt-1 text-2xl font-black text-blue-700">{formatPrice(property.startingPrice)}</p><p className="mt-2 font-bold">{property.name}</p><div className="mt-5 grid gap-3"><label className="grid gap-1 text-xs font-bold">تاریخ ورود<input className="rounded-lg border px-3 py-2.5" type="date" /></label><label className="grid gap-1 text-xs font-bold">تاریخ خروج<input className="rounded-lg border px-3 py-2.5" type="date" /></label><label className="grid gap-1 text-xs font-bold">تعداد مهمان<input className="rounded-lg border px-3 py-2.5" defaultValue="2" min="1" type="number" /></label></div><button className="mt-5 w-full rounded-lg bg-blue-600 px-4 py-3 font-black text-white" type="button">بررسی موجودی</button><p className="mt-3 text-center text-xs text-slate-400">رزرو در نسخه بعدی فعال می‌شود.</p></aside>
      </div>
    </div>
  </div>;
}

function persianBed(value: string) { const match = value.match(/^(\d+) x (.+)$/); return match ? `${match[1]} ${bedLabels[match[2]] ?? match[2]}` : value; }
function RoomNotes({ room }: { room: PublicRoom }) { const notes = [room.notes, room.floorNumber != null ? `طبقه ${room.floorNumber}` : "", room.stairCount != null ? `${room.stairCount} پله` : "", room.hasPrivateBathroom == null ? "" : room.hasPrivateBathroom ? "سرویس بهداشتی اختصاصی" : "سرویس مشترک", room.hasWindow == null ? "" : room.hasWindow ? "دارای پنجره" : "بدون پنجره"].filter(Boolean); return <div className="mt-3"><p className="text-sm text-slate-600">{room.description}</p>{notes.length > 0 && <p className="mt-2 text-sm font-semibold text-slate-700">{notes.join(" | ")}</p>}</div>; }
function Gallery({ image, name, className = "" }: { image: PublicImage; name: string; className?: string }) { return <img alt={image.altText || image.caption || name} className={`h-full w-full object-cover ${className}`} src={image.url} />; }
function Badge({ children, green = false }: { children: React.ReactNode; green?: boolean }) { return <span className={`rounded-full px-3 py-1 text-xs font-bold ${green ? "bg-green-50 text-green-700" : "bg-blue-50 text-blue-700"}`}>{children}</span>; }
function Highlight({ title, value }: { title: string; value: string }) { return <article className="rounded-xl border bg-white p-4"><p className="text-xs font-bold text-slate-400">{title}</p><p className="mt-2 font-black">{value}</p></article>; }
function Empty({ children }: { children: React.ReactNode }) { return <p className="mt-4 rounded-xl border border-dashed bg-white p-6 text-center text-slate-500">{children}</p>; }
function PageMessage({ children, error }: { children?: React.ReactNode; error?: string }) { return <div className="mx-auto min-h-[60vh] max-w-7xl px-5 py-16" dir="rtl">{error ? <><p className="rounded-xl bg-red-50 p-6 text-red-700">{error}</p><Link className="mt-5 inline-block font-bold text-blue-700" href="/properties">بازگشت به اقامتگاه‌ها</Link></> : children}</div>; }
