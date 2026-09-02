"use client";

import { AdminPage } from "@/components/admin/AdminPage";
import { PropertySettingManagement } from "@/components/admin/PropertySettingManagement";
import { ThemeSelector } from "@/components/ThemeSelector";

export default function AdminSettingsPage() {
  return (
    <AdminPage title="تنظیمات">
      <PropertySettingManagement />
      <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-[var(--shadow-subtle)]">
        <ThemeSelector />
      </section>
    </AdminPage>
  );
}
