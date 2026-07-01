import type { PropertyCompletionSectionResponse } from "@/lib/owner-api";

export type PropertyCompletionWorkspace = "admin" | "owner";

export function propertyCompletionHref(
  workspace: PropertyCompletionWorkspace,
  propertyId: number,
  section: PropertyCompletionSectionResponse,
) {
  const base = `/${workspace}/properties/${propertyId}`;
  const target = section.actionTarget || section.key;

  if (target === "rooms") return `${base}/rooms`;
  if (target === "pricing" || target === "financial") return `${base}/pricing`;
  if (target === "availability") return `${base}/inventory`;

  const stepByTarget: Record<string, number> = {
    basic: 0,
    location: 1,
    amenities: 3,
    images: 4,
    policies: 7,
  };

  const step = stepByTarget[target];
  return step == null ? base : `${base}?step=${step}`;
}
