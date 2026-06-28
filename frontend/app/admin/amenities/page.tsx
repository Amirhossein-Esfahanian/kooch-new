"use client";

import { AdminPage } from "@/components/admin/AdminPage";
import { AmenityManagement } from "@/components/amenities/AmenityManagement";

export default function AdminAmenityManagementPage() {
  return (
    <AdminPage title="مدیریت امکانات">
      <AmenityManagement />
    </AdminPage>
  );
}
