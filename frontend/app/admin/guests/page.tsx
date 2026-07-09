"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { AdminLayout } from "@/components/dashboard/DashboardLayouts";
import { GuestManagement } from "@/components/guests/GuestManagement";
import { KoochPageHeader } from "@/components/KoochPageHeader";
import { getToken } from "@/lib/owner-api";

export default function AdminGuestsPage() {
  const router = useRouter();

  useEffect(() => {
    if (!getToken()) router.replace("/login");
  }, [router]);

  return (
    <AdminLayout>
      <main className="mx-auto grid max-w-[1480px] gap-5 p-4 lg:p-6">
        <KoochPageHeader
          description="مدیریت مهمان‌ها برای استفاده داخلی در رزروها"
          eyebrow="مدیریت داخلی"
          title="مدیریت مهمان‌ها"
        />
        <GuestManagement />
      </main>
    </AdminLayout>
  );
}
