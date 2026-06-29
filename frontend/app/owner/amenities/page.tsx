"use client";

import { AmenityManagement } from "@/components/amenities/AmenityManagement";
import { OwnerLayout } from "@/components/dashboard/DashboardLayouts";
import { KoochPageHeader } from "@/components/KoochPageHeader";

export default function AmenityManagementPage() {
  return (
    <OwnerLayout>
      <main className="mx-auto grid max-w-[1480px] gap-5 p-4 lg:p-6">
        <KoochPageHeader eyebrow="پنل مالک" title="مدیریت امکانات" />
        <AmenityManagement />
      </main>
    </OwnerLayout>
  );
}
