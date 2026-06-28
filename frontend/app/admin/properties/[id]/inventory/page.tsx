"use client";

import { useParams } from "next/navigation";
import { AdminPropertyPanel } from "@/components/admin/AdminPropertyPanel";
import { OwnerInventoryGrid } from "@/components/owner/OwnerInventoryGrid";

export default function AdminInventoryPage() {
  const params = useParams<{ id: string }>();
  const propertyId = Number(params.id);

  return (
    <AdminPropertyPanel propertyId={propertyId} title="ظرفیت اتاق‌ها">
      <OwnerInventoryGrid propertyId={propertyId} />
    </AdminPropertyPanel>
  );
}
