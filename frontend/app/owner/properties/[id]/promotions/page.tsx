"use client";

import { useParams } from "next/navigation";
import { OwnerPanel } from "@/components/owner/OwnerPanel";
import { PromotionWorkspace } from "@/components/promotions/PromotionWorkspace";

export default function OwnerPromotionsPage() {
  const propertyId = Number(useParams<{ id: string }>().id);
  return <OwnerPanel propertyId={propertyId} title="پروموشن‌ها"><PromotionWorkspace propertyId={propertyId} /></OwnerPanel>;
}
