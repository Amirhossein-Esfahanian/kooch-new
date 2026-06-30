"use client";

import { KoochPageHeader } from "@/components/KoochPageHeader";
import { AdminLayout } from "@/components/dashboard/DashboardLayouts";
import { PromotionWorkspace } from "@/components/promotions/PromotionWorkspace";

export default function AdminPromotionsPage() {
  return (
    <AdminLayout>
      <main className="mx-auto grid max-w-[1480px] gap-5 p-4 lg:p-6">
        <KoochPageHeader
          description="قالب‌های مدیریتی و پروموشن‌های اقامتگاه‌ها را مدیریت کنید."
          eyebrow="پنل مدیریت"
          title="مدیریت پروموشن‌ها"
        />
        <PromotionWorkspace admin />
      </main>
    </AdminLayout>
  );
}
