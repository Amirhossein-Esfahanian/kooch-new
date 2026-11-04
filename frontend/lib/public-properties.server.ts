import "server-only";

import { cache } from "react";
import type { PublicProperty } from "@/lib/public-properties";
import { resolveBackendOrigin } from "@/lib/site-settings.server";

async function getPublicPropertyData(path: string): Promise<Response> {
  const origin = resolveBackendOrigin();
  if (!origin) throw new Error("KOOCH_BACKEND_ORIGIN is required for public Property server rendering.");
  // Never forward a visitor's credentials, or retain publication status across requests.
  return fetch(new URL(`/api/properties${path}`, origin), {
    cache: "no-store",
    credentials: "omit",
    signal: AbortSignal.timeout(10_000),
  });
}

export const getPublicBookingProperty = cache(async (slug: string): Promise<PublicProperty | null> => {
  const response = await getPublicPropertyData(`/${encodeURIComponent(slug)}`);
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Public Property request failed (${response.status}).`);
  const property: PublicProperty = await response.json();
  return property?.status === "Approved" ? property : null;
});

export async function getPublicBookingProperties(): Promise<PublicProperty[]> {
  const response = await getPublicPropertyData("");
  if (!response.ok) throw new Error(`Public Property list failed (${response.status}).`);
  const properties: PublicProperty[] = await response.json();
  if (!Array.isArray(properties)) throw new Error("Invalid public Property list.");
  return properties.filter((property) => property?.status === "Approved");
}
