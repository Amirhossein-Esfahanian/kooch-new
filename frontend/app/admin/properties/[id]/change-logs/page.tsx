"use client";

import { useParams } from "next/navigation";
import { AuditLogTable } from "@/components/audit/AuditLogTable";
import { AdminLayout } from "@/components/dashboard/DashboardLayouts";

export default function AdminPropertyAuditLogsPage() {
  const propertyId = Number(useParams<{ id: string }>().id);

  return (
    <AdminLayout>
      <main className="mx-auto grid max-w-[1480px] gap-5 p-4 lg:p-6">
        <AuditLogTable propertyId={propertyId} />
      </main>
    </AdminLayout>
  );
}
