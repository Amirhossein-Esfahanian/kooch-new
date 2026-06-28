"use client";

import { AmenityManagement } from "@/components/amenities/AmenityManagement";
import { OwnerPage } from "@/components/owner/OwnerPage";

export default function AmenityManagementPage() {
  return (
    <OwnerPage title="مدیریت امکانات">
      <AmenityManagement />
    </OwnerPage>
  );
}
