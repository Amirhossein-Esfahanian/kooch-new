"use client";

import { AdminLayout, DashboardHomeContent } from "@/components/dashboard/DashboardLayouts";

export default function AdminDashboardPage() {
  return (
    <AdminLayout>
      {(darkMode) => <DashboardHomeContent darkMode={darkMode} />}
    </AdminLayout>
  );
}
