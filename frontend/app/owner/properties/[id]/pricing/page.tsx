"use client";

import { useParams } from "next/navigation";
import { OwnerPanel } from "@/components/owner/OwnerPanel";
import { OwnerPricingGrid } from "@/components/owner/OwnerPricingGrid";

export default function OwnerPricingPage() {
  const propertyId = Number(useParams<{ id: string }>().id);
  return (
    <OwnerPanel propertyId={propertyId} title="قیمت‌گذاری اتاق‌ها">
      <OwnerPricingGrid propertyId={propertyId} />
    </OwnerPanel>
  );
}
