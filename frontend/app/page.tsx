"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { fetchPublicApi, formatPrice, PublicProperty } from "@/lib/public-properties";

export default function HomePage() {
  const [properties, setProperties] = useState<PublicProperty[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    fetchPublicApi<PublicProperty[]>("/properties")
      .then(setProperties)
      .catch((caught: Error) => setError(caught.message))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="px-5 py-12 sm:px-8 sm:py-16">
      <div className="mx-auto max-w-6xl">
        <p className="text-sm font-bold uppercase tracking-widest text-coral">Kooch stays</p>
        <h1 className="mt-3 text-4xl font-black tracking-tight sm:text-5xl">Approved properties</h1>
        <p className="mt-4 max-w-2xl text-ink/65">A simple live view of properties currently approved for public listing.</p>

        {loading && <p className="mt-10 rounded-xl border border-ink/10 bg-white p-6">Loading properties...</p>}
        {error && <p className="mt-10 rounded-xl bg-red-50 p-6 text-red-700">{error}</p>}
        {!loading && !error && properties.length === 0 && <p className="mt-10 rounded-xl border border-dashed border-ink/20 p-8 text-center">No approved properties are available yet.</p>}

        <div className="mt-10 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {properties.map((property) => (
            <article className="overflow-hidden rounded-2xl border border-ink/10 bg-white shadow-sm" key={property.id}>
              {property.coverImageUrl ? <img alt={property.name} className="aspect-[4/3] w-full object-cover" src={property.coverImageUrl} /> : <div className="grid aspect-[4/3] place-items-center bg-ink/5 text-sm text-ink/45">No image</div>}
              <div className="p-5">
                <p className="text-sm font-semibold text-ink/55">{property.city} · {property.propertyType.replace(/([A-Z])/g, " $1").trim()}</p>
                <h2 className="mt-1 text-xl font-black">{property.name}</h2>
                <p className="mt-3 font-bold text-moss">From {formatPrice(property.startingPrice)}</p>
                <Link className="mt-5 block rounded-lg bg-ink px-4 py-3 text-center text-sm font-bold text-white" href={`/properties/${property.slug}`}>View property</Link>
              </div>
            </article>
          ))}
        </div>
      </div>
    </div>
  );
}
