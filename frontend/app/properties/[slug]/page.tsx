"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { fetchPublicApi, formatPrice, PublicProperty } from "@/lib/public-properties";

export default function PublicPropertyPage() {
  const { slug } = useParams<{ slug: string }>();
  const [property, setProperty] = useState<PublicProperty | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!slug) return;
    setLoading(true);
    fetchPublicApi<PublicProperty>(`/properties/${encodeURIComponent(slug)}`)
      .then(setProperty)
      .catch((caught: Error) => setError(caught.message))
      .finally(() => setLoading(false));
  }, [slug]);

  if (loading) return <div className="mx-auto max-w-6xl px-5 py-16">Loading property...</div>;
  if (error || !property) return <div className="mx-auto max-w-6xl px-5 py-16"><p className="rounded-xl bg-red-50 p-6 text-red-700">{error || "Property not found."}</p><Link className="mt-5 inline-block font-bold underline" href="/">Back to properties</Link></div>;

  return (
    <div className="px-5 py-10 sm:px-8 sm:py-14">
      <div className="mx-auto max-w-6xl">
        <Link className="text-sm font-bold text-moss hover:underline" href="/">&larr; Back to properties</Link>
        <div className="mt-6">
          <p className="text-sm font-semibold text-coral">{property.city}</p>
          <h1 className="mt-2 text-4xl font-black tracking-tight sm:text-5xl">{property.name}</h1>
          <p className="mt-3 text-ink/60">{property.address}</p>
        </div>

        {property.imageUrls.length > 0 && <div className="mt-8 grid gap-3 sm:grid-cols-2">{property.imageUrls.map((url, index) => <img alt={`${property.name} image ${index + 1}`} className={`w-full rounded-xl object-cover ${index === 0 ? "sm:col-span-2 aspect-[16/7]" : "aspect-[4/3]"}`} key={url} src={url} />)}</div>}

        <section className="mt-10 max-w-3xl">
          <h2 className="text-2xl font-black">About this property</h2>
          <p className="mt-4 whitespace-pre-line leading-8 text-ink/70">{property.description}</p>
        </section>

        {(property.amenities.length > 0 || property.nearbyPlaces.length > 0) && <div className="mt-10 grid gap-8 md:grid-cols-2">
          {property.amenities.length > 0 && <section><h2 className="text-2xl font-black">Amenities</h2><div className="mt-4 flex flex-wrap gap-2">{property.amenities.map((amenity) => <span className="rounded-full bg-white px-3 py-2 text-sm font-semibold shadow-sm" key={amenity.id}>{amenity.name}</span>)}</div></section>}
          {property.nearbyPlaces.length > 0 && <section><h2 className="text-2xl font-black">Nearby places</h2><div className="mt-4 grid gap-3">{property.nearbyPlaces.map((place) => <article className="rounded-xl bg-white p-4 shadow-sm" key={place.id}><strong>{place.title}</strong><p className="mt-1 text-sm text-ink/55">{place.category}{place.distanceInMeters !== null ? ` · ${place.distanceInMeters} m` : ""}{place.walkingMinutes !== null ? ` · ${place.walkingMinutes} min walk` : ""}</p>{place.description && <p className="mt-2 text-sm text-ink/65">{place.description}</p>}</article>)}</div></section>}
        </div>}

        <section className="mt-12">
          <h2 className="text-2xl font-black">Rooms and prices</h2>
          <div className="mt-5 grid gap-5">
            {property.roomTypes.length === 0 && <p className="rounded-xl border border-dashed border-ink/20 p-6">No active room types are listed yet.</p>}
            {property.roomTypes.map((roomType) => (
              <article className="rounded-xl border border-ink/10 bg-white p-5 shadow-sm" key={roomType.id}>
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <h3 className="text-xl font-black">{roomType.name}</h3>
                    <p className="mt-1 text-sm text-ink/55">{roomType.inventoryMode === "NamedRooms" ? "Named rooms" : "Room-type inventory"} · Total inventory: {roomType.totalInventory}</p>
                  </div>
                  <p className="font-black text-moss">{formatPrice(roomType.displayPrice)}</p>
                </div>
                {roomType.description && <p className="mt-4 text-sm leading-6 text-ink/65">{roomType.description}</p>}
                {roomType.namedRooms.length > 0 && <div className="mt-4"><p className="text-sm font-bold">Named rooms</p><div className="mt-2 flex flex-wrap gap-2">{roomType.namedRooms.map((room) => <span className="rounded-full bg-cream px-3 py-1 text-sm font-semibold" key={room.id}>{room.name}</span>)}</div></div>}
                {roomType.availabilityPrice !== null && roomType.basePrice !== null && roomType.availabilityPrice !== roomType.basePrice && <p className="mt-4 text-xs text-ink/50">Base price: {formatPrice(roomType.basePrice)}</p>}
              </article>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
