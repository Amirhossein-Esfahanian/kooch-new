"use client";

import { DashboardHomeContent, OwnerLayout } from "@/components/dashboard/DashboardLayouts";

export default function OwnerHomePage() {
  return (
    <OwnerLayout>
      {(darkMode) => <DashboardHomeContent darkMode={darkMode} />}
    </OwnerLayout>
  );
}
