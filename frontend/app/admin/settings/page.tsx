"use client";

import { AdminPage } from "@/components/admin/AdminPage";
import { ThemeSelector } from "@/components/ThemeSelector";

export default function AdminSettingsPage() {
  return (
    <AdminPage title="تنظیمات">
      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-[var(--shadow-subtle)]">
        <ThemeSelector />
      </section>
    </AdminPage>
  );
}
