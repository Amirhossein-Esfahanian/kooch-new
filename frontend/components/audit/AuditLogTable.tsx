"use client";

import { useEffect, useState } from "react";
import { KoochBadge } from "@/components/KoochBadge";
import { KoochCard } from "@/components/KoochCard";
import {
  KoochTable,
  KoochTableBody,
  KoochTableCell,
  KoochTableEmpty,
  KoochTableHead,
  KoochTableHeader,
  KoochTableRow,
} from "@/components/KoochTable";
import { apiRequest, AuditAction, AuditLogResponse } from "@/lib/owner-api";

const actionLabels: Record<AuditAction, string> = {
  PriceChanged: "تغییر قیمت",
  InventoryChanged: "تغییر ظرفیت",
  RoomCreated: "ایجاد اتاق",
  RoomDeleted: "حذف اتاق",
  BookingConfirmed: "تأیید رزرو",
  BookingCancelled: "??? ????",
  BookingApproved: "Booking approved",
  BookingExpired: "Booking expired",
  PropertyOwnershipTransferred: "Ownership transferred",
};

function actionVariant(action: AuditAction) {
  if (action === "RoomDeleted" || action === "BookingCancelled" || action === "BookingExpired") {
    return "destructive" as const;
  }

  if (action === "BookingConfirmed" || action === "BookingApproved" || action === "RoomCreated") {
    return "success" as const;
  }

  if (action === "InventoryChanged" || action === "PropertyOwnershipTransferred") {
    return "warning" as const;
  }

  return "default" as const;
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat("fa-IR", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export function AuditLogTable({ propertyId }: { propertyId: number }) {
  const [logs, setLogs] = useState<AuditLogResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    setLoading(true);
    setError("");
    apiRequest<AuditLogResponse[]>(
      `/owner/properties/${propertyId}/audit-logs`,
    )
      .then(setLogs)
      .catch((caught: Error) => setError(caught.message))
      .finally(() => setLoading(false));
  }, [propertyId]);

  return (
    <KoochCard className="grid gap-4" padding="none" variant="elevated">
      <div className="border-b border-border p-5">
        <h2 className="text-xl font-black text-foreground">Audit Log</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          رویدادهای مهم این اقامتگاه به صورت فقط خواندنی نمایش داده می‌شود.
        </p>
      </div>

      {error && (
        <div className="mx-5 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm font-semibold text-destructive">
          {error}
        </div>
      )}

      <div className="px-5 pb-5">
        <KoochTable>
          <KoochTableHeader>
            <KoochTableRow>
              <KoochTableHead>زمان</KoochTableHead>
              <KoochTableHead>کاربر</KoochTableHead>
              <KoochTableHead>عملیات</KoochTableHead>
              <KoochTableHead>اقامتگاه</KoochTableHead>
              <KoochTableHead>Entity</KoochTableHead>
              <KoochTableHead>توضیحات</KoochTableHead>
            </KoochTableRow>
          </KoochTableHeader>
          <KoochTableBody>
            {loading ? (
              <KoochTableEmpty colSpan={6}>در حال بارگذاری...</KoochTableEmpty>
            ) : logs.length === 0 ? (
              <KoochTableEmpty colSpan={6}>
                هنوز رویدادی برای این اقامتگاه ثبت نشده است.
              </KoochTableEmpty>
            ) : (
              logs.map((log) => (
                <KoochTableRow key={log.id}>
                  <KoochTableCell className="whitespace-nowrap">
                    {formatDate(log.time)}
                  </KoochTableCell>
                  <KoochTableCell>{log.user}</KoochTableCell>
                  <KoochTableCell>
                    <KoochBadge variant={actionVariant(log.action)}>
                      {actionLabels[log.action] ?? log.action}
                    </KoochBadge>
                  </KoochTableCell>
                  <KoochTableCell>{log.property ?? "-"}</KoochTableCell>
                  <KoochTableCell>
                    <div className="grid gap-1">
                      <span className="font-black text-foreground">
                        {log.entityName ?? log.entity}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {log.entity}
                        {log.entityId ? ` #${log.entityId}` : ""}
                      </span>
                    </div>
                  </KoochTableCell>
                  <KoochTableCell className="max-w-md">
                    {log.description ?? "-"}
                  </KoochTableCell>
                </KoochTableRow>
              ))
            )}
          </KoochTableBody>
        </KoochTable>
      </div>
    </KoochCard>
  );
}
