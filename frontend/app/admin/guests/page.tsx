"use client";

import { AdminLayout } from "@/components/dashboard/DashboardLayouts";
import { GuestManagement } from "@/components/guests/GuestManagement";
import { KoochPageHeader } from "@/components/KoochPageHeader";

export default function AdminGuestsPage() {
  return (
    <AdminLayout>
      <main className="mx-auto grid max-w-[1480px] gap-5 p-4 lg:p-6">
        <KoochPageHeader
          appearance="plain"
          description="مدیریت مهمان‌ها برای استفاده داخلی در رزروها"
          eyebrow="مدیریت داخلی"
          title="مدیریت مهمان‌ها"
        />
        <GuestManagement />
      </main>
    </AdminLayout>
  );
}
