"use client";

import type { ReactNode } from "react";
import { AdminLayout } from "@/components/dashboard/DashboardLayouts";

export function AdminPage({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <AdminLayout>
      <main className="mx-auto grid max-w-[1480px] gap-5 p-4 lg:p-6">
        <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-[#171d27]">
          <p className="text-sm font-bold text-[var(--theme-primary-text)]">
            پنل مدیریت
          </p>
          <h1 className="mt-2 text-3xl font-bold text-slate-950 dark:text-slate-100">
            {title}
          </h1>
        </section>
        {children}
      </main>
    </AdminLayout>
  );
}
