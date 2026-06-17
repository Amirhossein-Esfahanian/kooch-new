"use client";

import { useParams } from "next/navigation";
import { OwnerPanel } from "@/components/owner/OwnerPanel";
import { RoomManagement } from "@/components/owner/RoomManagement";

export default function OwnerRoomsPage() {
  const propertyId = Number(useParams<{ id: string }>().id);
  return (
    <OwnerPanel propertyId={propertyId} title="اتاق‌ها">
      <RoomManagement propertyId={propertyId} />
    </OwnerPanel>
  );
}
