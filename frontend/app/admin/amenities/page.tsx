"use client";

import { AmenityManagement } from "@/components/amenities/AmenityManagement";
import { AdminLayout } from "@/components/dashboard/DashboardLayouts";
import { KoochPageHeader } from "@/components/KoochPageHeader";

export default function AdminAmenityManagementPage() {
  return (
    <AdminLayout>
      <main className="mx-auto grid max-w-[1480px] gap-5 p-4 lg:p-6">
        <KoochPageHeader eyebrow="" title="مدیریت امکانات" />
        <AmenityManagement mode="admin" />
      </main>
    </AdminLayout>
  );
}
