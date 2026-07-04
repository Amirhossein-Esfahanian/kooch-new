"use client";

import Link from "next/link";
import { AdminLayout } from "@/components/dashboard/DashboardLayouts";
import { KoochCard } from "@/components/KoochCard";
import { KoochPageHeader } from "@/components/KoochPageHeader";

const linkButtonClass =
  "inline-flex min-h-10 items-center justify-center rounded-md border px-4 py-2 text-center text-sm font-semibold transition focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-background";

export default function AdminReservationSettingsPage() {
  return (
    <AdminLayout>
      <main className="mx-auto grid max-w-[1480px] gap-5 p-4 lg:p-6">
        <KoochPageHeader
          description="تنظیمات عمومی رزرو در تنظیمات سایت نگهداری می‌شود."
          eyebrow=""
          title="تنظیمات رزرو"
        />

        <KoochCard variant="elevated">
          <h2 className="text-xl font-black text-foreground">
            تنظیمات رزرو از تنظیمات سایت مدیریت می‌شود
          </h2>
          <p className="mt-3 text-sm leading-7 text-muted-foreground">
            حداقل قیمت، حداکثر قیمت و درصدهای کمیسیون فقط در بخش تنظیمات سایت
            قابل ویرایش هستند. پشتیبانی از override کمیسیون برای هر اقامتگاه در
            آینده اضافه می‌شود.
          </p>
          <Link
            className={`${linkButtonClass} mt-5 border-primary bg-primary text-primary-foreground hover:bg-[var(--primary-hover)]`}
            href="/admin/site-settings"
          >
            رفتن به تنظیمات سایت
          </Link>
        </KoochCard>
      </main>
    </AdminLayout>
  );
}
