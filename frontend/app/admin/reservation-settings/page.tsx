"use client";

import Link from "next/link";
import { AdminPage } from "@/components/admin/AdminPage";

export default function AdminReservationSettingsPage() {
  return (
    <AdminPage title="تنظیمات رزرو">
      <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-[#171d27]">
        <h2 className="text-xl font-black text-slate-950 dark:text-slate-100">
          تنظیمات رزرو از تنظیمات سایت مدیریت می‌شود
        </h2>
        <p className="mt-3 text-sm leading-7 text-slate-500 dark:text-slate-400">
          حداقل قیمت، حداکثر قیمت و درصدهای کمیسیون فقط در بخش تنظیمات سایت قابل
          ویرایش هستند. پشتیبانی از override کمیسیون برای هر اقامتگاه در آینده
          اضافه می‌شود.
        </p>
        <Link
          className="mt-5 inline-flex ds-button-primary"
          href="/admin/site-settings"
        >
          رفتن به تنظیمات سایت
        </Link>
      </section>
    </AdminPage>
  );
}
