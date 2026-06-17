"use client";

import { useParams } from "next/navigation";
import { OwnerInventoryGrid } from "@/components/owner/OwnerInventoryGrid";
import { OwnerPanel } from "@/components/owner/OwnerPanel";

export default function OwnerInventoryPage() {
  const params = useParams<{ id: string }>();
  const propertyId = Number(params.id);
  return (
    <OwnerPanel propertyId={propertyId} title="ظرفیت اتاق‌ها">
      <OwnerInventoryGrid propertyId={propertyId} />
    </OwnerPanel>
  );
}
