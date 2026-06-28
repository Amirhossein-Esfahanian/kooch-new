"use client";

import { useParams } from "next/navigation";
import { AdminPropertyPanel } from "@/components/admin/AdminPropertyPanel";
import { OwnerPricingGrid } from "@/components/owner/OwnerPricingGrid";

export default function AdminPricingPage() {
  const propertyId = Number(useParams<{ id: string }>().id);

  return (
    <AdminPropertyPanel propertyId={propertyId} showPricingWarnings={false} title="قیمت‌گذاری اتاق‌ها">
      <OwnerPricingGrid context="admin" propertyId={propertyId} />
    </AdminPropertyPanel>
  );
}
