"use client";

import Link from "next/link";
import { KoochCard } from "@/components/KoochCard";
import { KoochPageHeader } from "@/components/KoochPageHeader";
import { useAuthSession } from "@/components/auth/AuthSessionProvider";
import { AdminLayout } from "@/components/dashboard/DashboardLayouts";
import { PromotionWorkspace } from "@/components/promotions/PromotionWorkspace";

export default function AdminPromotionsPage() {
  const { platformRole, platformPermissions } = useAuthSession();
  const canManageWelcomeGifts =
    platformRole === "SuperAdmin" || platformPermissions.includes("ManagePromotions");

  return (
    <AdminLayout>
      <main className="mx-auto grid max-w-[1480px] gap-5 p-4 lg:p-6">
        <KoochPageHeader
          appearance="plain"
          description="قالب‌های مدیریتی و پروموشن‌های اقامتگاه‌ها را مدیریت کنید."
          eyebrow="پنل مدیریت"
          title="مدیریت پروموشن‌ها"
        />
        {canManageWelcomeGifts && (
          <Link
            className="block rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            href="/admin/welcome-gifts"
          >
            <KoochCard className="flex flex-wrap items-center justify-between gap-3 transition-colors hover:border-primary">
              <div>
                <h2 className="text-base font-semibold">هدیه خوش‌آمدگویی</h2>
                <p className="mt-1 text-sm text-muted-foreground">مدیریت کمپین‌های هدیه برای کاربران واجد شرایط</p>
              </div>
              <span className="text-sm font-semibold text-primary">مشاهده کمپین‌ها</span>
            </KoochCard>
          </Link>
        )}
        <PromotionWorkspace admin />
      </main>
    </AdminLayout>
  );
}
