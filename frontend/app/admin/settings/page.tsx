"use client";

import { AdminPage } from "@/components/admin/AdminPage";
import { BedTypeManagement } from "@/components/admin/BedTypeManagement";
import { PropertySettingManagement } from "@/components/admin/PropertySettingManagement";
import { ThemeSelector } from "@/components/ThemeSelector";

export default function AdminSettingsPage() {
  return (
    <AdminPage title="تنظیمات">
      <BedTypeManagement />
      <PropertySettingManagement />
      <section className="rounded-lg border border-border bg-card p-4 text-card-foreground shadow-[var(--shadow-subtle)]">
        <ThemeSelector />
      </section>
    </AdminPage>
  );
}
