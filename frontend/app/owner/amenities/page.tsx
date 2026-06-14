"use client";

import { useEffect, useState } from "react";
import { OwnerPage } from "@/components/owner/OwnerPage";
import {
  AmenityCategoryResponse,
  AmenityResponse,
  apiRequest,
} from "@/lib/owner-api";

export default function AmenityManagementPage() {
  const [categories, setCategories] = useState<AmenityCategoryResponse[]>([]);
  const [amenities, setAmenities] = useState<AmenityResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    Promise.all([
      apiRequest<AmenityCategoryResponse[]>("/amenity-categories"),
      apiRequest<AmenityResponse[]>("/amenities"),
    ])
      .then(([categoryResults, amenityResults]) => {
        setCategories(categoryResults);
        setAmenities(amenityResults);
      })
      .catch((caught: Error) => setError(caught.message))
      .finally(() => setLoading(false));
  }, []);

  return (
    <OwnerPage title="Amenity management">
      <p className="mb-6 text-ink/65">
        Amenities are grouped by category. Property assignment controls can be added later.
      </p>
      {loading && <p>Loading amenities...</p>}
      {error && <p className="rounded-lg bg-red-50 p-3 text-red-700">{error}</p>}
      <div className="grid gap-5">
        {categories.map((category) => {
          const categoryAmenities = amenities.filter(
            (amenity) => amenity.amenityCategoryId === category.id,
          );

          return (
            <section className="rounded-xl border border-ink/10 bg-white p-5 shadow-sm" key={category.id}>
              <div className="mb-4 flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-xl font-bold">{category.name}</h2>
                  <p className="text-sm text-ink/50">{categoryAmenities.length} amenities</p>
                </div>
                {category.icon && <span className="rounded-full bg-sand px-3 py-1 text-xs font-semibold">{category.icon}</span>}
              </div>
              {categoryAmenities.length === 0 ? (
                <p className="text-sm text-ink/50">No amenities in this category.</p>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {categoryAmenities.map((amenity) => (
                    <article className="rounded-lg border border-ink/10 bg-cream/50 p-3" key={amenity.id}>
                      <h3 className="font-bold">{amenity.name}</h3>
                      <p className="mt-1 text-xs font-semibold uppercase tracking-wide text-ink/45">{amenity.scope}</p>
                      {amenity.description && <p className="mt-2 text-sm text-ink/65">{amenity.description}</p>}
                    </article>
                  ))}
                </div>
              )}
            </section>
          );
        })}
      </div>
    </OwnerPage>
  );
}
