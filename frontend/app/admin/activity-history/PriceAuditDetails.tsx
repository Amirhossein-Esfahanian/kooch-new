"use client";

import { useEffect, useState } from "react";
import { KoochAlert } from "@/components/KoochAlert";
import { KoochButton } from "@/components/KoochButton";
import { KoochTable, KoochTableHeader, KoochTableHead, KoochTableBody, KoochTableRow, KoochTableCell } from "@/components/KoochTable";
import { apiRequest } from "@/lib/owner-api";
import { formatNumber } from "@/lib/account-reservations";
import { formatCurrency } from "@/lib/currency";
import { auditValue, type AdminAuditLog, type AdminPriceChangePage } from "@/lib/admin-audit-logs";

const stayDate = new Intl.DateTimeFormat("fa-IR", { timeZone: "UTC", year: "numeric", month: "2-digit", day: "2-digit" });

export function PriceAuditDetails({ row }: { row: AdminAuditLog }) {
  const [open, setOpen] = useState(false);
  const [request, setRequest] = useState({ after: null as string | null, retry: 0 });
  const [data, setData] = useState<AdminPriceChangePage | null>(null);
  const [compact, setCompact] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!open || !row.propertyId) return;
    let active = true;
    const controller = new AbortController();
    setLoading(true); setError(false);
    const params = new URLSearchParams({ propertyId: String(row.propertyId), pageSize: "10" });
    if (request.after) params.set("after", request.after);
    apiRequest<AdminPriceChangePage>(`/admin/audit-logs/${row.id}/price-changes?${params}`, { signal: controller.signal })
      .then((response) => {
        if (active) setData((previous) => ({ ...response,
          items: request.after ? [...(previous?.items ?? []), ...response.items] : response.items }));
      })
      .catch(() => { if (active) setError(true); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; controller.abort(); };
  }, [open, row.id, row.propertyId, request]);

  const items = compact ? data?.items.slice(0, 10) : data?.items;
  return <details onToggle={(event) => {
    setOpen(event.currentTarget.open);
    if (!event.currentTarget.open) {
      setRequest({ after: null, retry: 0 }); setData(null); setCompact(false);
    }
  }}>
    <summary className="cursor-pointer rounded-sm text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">مشاهده تغییرات قیمت</summary>
    <div className="mt-3 space-y-3">
      <p className="text-sm text-muted-foreground">
        {formatNumber(Number(row.newValues?.ChangedCellCount ?? 0))} تاریخ تغییرکرده
        {row.newValues?.GuestType ? ` · مهمان ${auditValue(row.newValues.GuestType)}` : ""}
      </p>
      {items?.length ? <KoochTable className="min-w-80 tabular-nums" aria-label="تغییرات قیمت روزانه">
        <KoochTableHeader><KoochTableRow><KoochTableHead>تاریخ اقامت</KoochTableHead><KoochTableHead>قیمت قبل</KoochTableHead><KoochTableHead>قیمت بعد</KoochTableHead></KoochTableRow></KoochTableHeader>
        <KoochTableBody>{items.map((item) => <KoochTableRow key={item.date}>
          <KoochTableCell className="whitespace-nowrap"><time dateTime={item.date}>{stayDate.format(new Date(`${item.date}T00:00:00Z`))}</time></KoochTableCell>
          <KoochTableCell className="whitespace-nowrap">{formatCurrency(item.previousPrice)}</KoochTableCell>
          <KoochTableCell className="whitespace-nowrap">{formatCurrency(item.newPrice)}</KoochTableCell>
        </KoochTableRow>)}</KoochTableBody>
      </KoochTable> : data && !loading && !error ? <p className="text-sm text-muted-foreground">جزئیات تغییر قیمت ثبت نشده است.</p> : null}
      {loading && <p role="status" className="text-sm text-muted-foreground">در حال دریافت تغییرات قیمت…</p>}
      {error && <KoochAlert variant="destructive" title="جزئیات قیمت بارگذاری نشد">
        <KoochButton variant="outline" onClick={() => setRequest((value) => ({ ...value, retry: value.retry + 1 }))}>تلاش دوباره</KoochButton>
      </KoochAlert>}
      <div className="flex flex-wrap gap-2">
        {data && (compact || data.hasMore) && !error && <KoochButton size="sm" variant="outline" disabled={loading} onClick={() => {
          if (compact) setCompact(false);
          else setRequest((value) => ({ after: data.nextAfter, retry: value.retry + 1 }));
        }}>نمایش بیشتر</KoochButton>}
        {data && data.items.length > 10 && !compact && <KoochButton size="sm" variant="ghost" disabled={loading} onClick={() => setCompact(true)}>نمایش کمتر</KoochButton>}
      </div>
    </div>
  </details>;
}
