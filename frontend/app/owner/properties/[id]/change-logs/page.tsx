"use client";

import { useParams } from "next/navigation";
import { AuditLogTable } from "@/components/audit/AuditLogTable";
import { OwnerPanel } from "@/components/owner/OwnerPanel";

export default function OwnerChangeLogsPage() {
  const propertyId = Number(useParams<{ id: string }>().id);

  return (
    <OwnerPanel propertyId={propertyId} title="سوابق عملیات">
      <AuditLogTable propertyId={propertyId} />
    </OwnerPanel>
  );
}
