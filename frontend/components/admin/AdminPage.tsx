"use client";

import type { ReactNode } from "react";
import { AdminLayout } from "@/components/dashboard/DashboardLayouts";
import { KoochPageHeader } from "@/components/KoochPageHeader";

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
        <KoochPageHeader
          appearance="plain"
          eyebrow="پنل مدیریت"
          title={title}
        />
        {children}
      </main>
    </AdminLayout>
  );
}
