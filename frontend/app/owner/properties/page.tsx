"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { OwnerPage } from "@/components/owner/OwnerPage";
import { apiRequest, getToken, PropertyResponse } from "@/lib/owner-api";

export default function OwnerPropertiesPage() {
  const router = useRouter();
  const [properties, setProperties] = useState<PropertyResponse[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!getToken()) {
      router.replace("/owner/login");
      return;
    }
    apiRequest<PropertyResponse[]>("/owner/properties")
      .then(setProperties)
      .catch((caught: Error) => setError(caught.message))
      .finally(() => setLoading(false));
  }, [router]);

  return (
    <OwnerPage title="Properties">
      <div className="mb-5 flex justify-end">
        <Link className="rounded-lg bg-ink px-4 py-3 font-bold text-white" href="/owner/properties/new">Add property</Link>
      </div>
      {loading && <p>Loading properties...</p>}
      {error && <p className="rounded-lg bg-red-50 p-3 text-red-700">{error}</p>}
      {!loading && !error && properties.length === 0 && <p className="rounded-xl border border-dashed border-ink/20 p-8 text-center">No properties yet.</p>}
      <div className="grid gap-4">
        {properties.map((property) => (
          <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-ink/10 bg-white p-5 shadow-sm" key={property.id}>
            <div>
              <h2 className="text-xl font-bold">{property.name}</h2>
              <p className="text-sm text-ink/60">{property.city} · {property.status}</p>
            </div>
            <Link className="rounded-lg border border-ink/20 px-4 py-2 text-sm font-semibold" href={`/owner/properties/${property.id}`}>Edit / manage</Link>
          </div>
        ))}
      </div>
    </OwnerPage>
  );
}
