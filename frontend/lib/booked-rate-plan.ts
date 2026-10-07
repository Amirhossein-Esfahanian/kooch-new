export function bookedRatePlanLabel(hasExplicitRatePlan: boolean, snapshotName?: string | null): string {
  if (!hasExplicitRatePlan) return "نرخ استاندارد";
  return snapshotName?.trim() || "نرخ رزروشده";
}
