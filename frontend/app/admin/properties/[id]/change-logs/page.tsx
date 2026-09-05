"use client";

import { useParams } from "next/navigation";
import { AdminPropertyPanel } from "@/components/admin/AdminPropertyPanel";
import { AuditLogTable } from "@/components/audit/AuditLogTable";

export default function AdminPropertyAuditLogsPage() {
  const propertyId = Number(useParams<{ id: string }>().id);

  return (
    <AdminPropertyPanel
      description="رویدادهای مهم این اقامتگاه به‌صورت فقط‌خواندنی نمایش داده می‌شوند."
      propertyId={propertyId}
      sectionLabel="سوابق عملیات"
      showPricingWarnings={false}
      title="سوابق عملیات"
    >
      <AuditLogTable propertyId={propertyId} />
    </AdminPropertyPanel>
  );
}
