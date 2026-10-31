"use client";

import Link from "next/link";
import { PriceAuditDetails } from "./PriceAuditDetails";
import { useEffect, useState } from "react";
import { useAuthSession } from "@/components/auth/AuthSessionProvider";
import { AdminLayout } from "@/components/dashboard/DashboardLayouts";
import { KoochAlert } from "@/components/KoochAlert";
import { KoochButton } from "@/components/KoochButton";
import { KoochCard } from "@/components/KoochCard";
import { KoochDatePicker } from "@/components/KoochDatePicker";
import { KoochField, KoochSearchableSelect, KoochSelect } from "@/components/KoochFormControls";
import { KoochIcon } from "@/components/KoochIcon";
import { KoochPageHeader } from "@/components/KoochPageHeader";
import { KoochTable, KoochTableBody, KoochTableCell, KoochTableEmpty, KoochTableHead, KoochTableHeader, KoochTableRow } from "@/components/KoochTable";
import { apiRequest, ApiRequestError } from "@/lib/owner-api";
import { formatDateTime, formatNumber } from "@/lib/account-reservations";
import { adminAuditPath, auditActionLabels, auditFieldLabels, auditValue, emptyAuditFilters, type AdminAuditPage, type AuditFilters, type AdminAuditLog, type AdminAuditFilterOption } from "@/lib/admin-audit-logs";

const entityLabels: Record<string, string> = { Property: "اقامتگاه", RoomType: "نوع اتاق", Availability: "موجودی اتاق", RoomDailyPrice: "قیمت روزانه", SiteSetting: "تنظیمات سایت", CashbackSetting: "تنظیمات کش‌بک", Reservation: "رزرو", User: "کاربر" };

function Changes({ row }: { row: AdminAuditLog }) {
  if (row.hasPriceDetails) return <PriceAuditDetails row={row} />;
  const keys = [...new Set([...Object.keys(row.previousValues ?? {}), ...Object.keys(row.newValues ?? {})])]
    .filter((key) => Object.hasOwn(auditFieldLabels, key));
  if (!keys.length) return <span className="text-muted-foreground">مقادیر قبل و بعد ثبت نشده‌اند.</span>;
  return <div>
    <dl className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {keys.map((key) => <div key={key}>
        <dt className="font-medium">{auditFieldLabels[key]}</dt>
        <dd className="mt-1 break-words"><span className="text-muted-foreground">قبل: </span>{auditValue(row.previousValues?.[key])}</dd>
        <dd className="break-words"><span className="text-muted-foreground">بعد: </span>{auditValue(row.newValues?.[key])}</dd>
      </div>)}
    </dl>
    {row.action === "PriceChanged" && row.entityType === "RoomDailyPrice" && row.propertyId &&
      <Link href={`/admin/properties/${row.propertyId}/pricing`} className="mt-3 inline-block text-primary underline-offset-4 hover:underline">مشاهده تاریخچه قیمت اتاق‌ها</Link>}
  </div>;
}

function AuditFilterSelect({ kind, label, value, onChange, enabled }: {
  kind: "actors" | "properties"; label: string; value: string;
  onChange: (value: string) => void; enabled: boolean;
}) {
  const [search, setSearch] = useState("");
  const [options, setOptions] = useState<AdminAuditFilterOption[]>([]);
  const [selected, setSelected] = useState<AdminAuditFilterOption | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      const query = new URLSearchParams({ limit: "20" });
      if (search.trim()) query.set("search", search.trim());
      setLoading(true); setError(false);
      apiRequest<AdminAuditFilterOption[]>(`/admin/audit-logs/filter-options/${kind}?${query}`, { signal: controller.signal })
        .then((items) => { if (!controller.signal.aborted) setOptions(items); })
        .catch(() => { if (!controller.signal.aborted) setError(true); })
        .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    }, search ? 200 : 0);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [enabled, kind, search, retry]);

  const choices = selected && !options.some((item) => item.id === selected.id)
    ? [selected, ...options] : options;
  return <div className="min-w-0">
    <KoochField label={label}>
      <KoochSearchableSelect value={value} options={choices.map((item) => ({ value: item.id, label: item.displayName }))}
        placeholder={`همه ${label === "کاربر" ? "کاربران" : "اقامتگاه‌ها"}`}
        searchPlaceholder={`جست‌وجوی ${label}`} emptyText={loading ? "در حال جست‌وجو…" : "موردی پیدا نشد."}
        onSearchChange={setSearch} onChange={(next) => {
          setSelected(choices.find((item) => String(item.id) === next) ?? null);
          setSearch(""); onChange(next);
        }} />
    </KoochField>
    {error && <div className="mt-2 flex items-center gap-2 text-xs text-destructive" role="alert">
      <span>فهرست {label} بارگذاری نشد.</span>
      <KoochButton type="button" size="sm" variant="outline" onClick={() => setRetry((current) => current + 1)}>تلاش دوباره</KoochButton>
    </div>}
  </div>;
}

function AuditRow({ row }: { row: AdminAuditLog }) {
  const [expanded, setExpanded] = useState(false);
  const hasChanges = row.hasPriceDetails || Object.keys(row.previousValues ?? {}).some((key) => Object.hasOwn(auditFieldLabels, key)) ||
    Object.keys(row.newValues ?? {}).some((key) => Object.hasOwn(auditFieldLabels, key));
  const detailId = `audit-details-${row.id}`;
  return <>
    <KoochTableRow>
      <KoochTableCell><p>{row.actorDisplayName}</p><p className="text-xs text-muted-foreground">شناسه {formatNumber(row.userId)}</p></KoochTableCell>
      <KoochTableCell className="whitespace-nowrap"><time dateTime={row.occurredAtUtc} title={row.occurredAtUtc}>{row.hasPriceDetails ? new Intl.DateTimeFormat("fa-IR", { dateStyle: "short", timeStyle: "medium" }).format(new Date(row.occurredAtUtc)) : formatDateTime(row.occurredAtUtc)}</time></KoochTableCell>
      <KoochTableCell>{auditActionLabels[row.action] ?? "رویداد ثبت‌شده"}</KoochTableCell>
      <KoochTableCell><p>{row.entityName ?? entityLabels[row.entityType] ?? "مورد ثبت‌شده"}{row.entityId ? ` · ${formatNumber(row.entityId)}` : ""}</p><p className="text-sm text-muted-foreground">{row.propertyName ?? "سطح سامانه"}</p>{row.propertyId && <p className="text-xs text-muted-foreground">شناسه اقامتگاه {formatNumber(row.propertyId)}</p>}</KoochTableCell>
      <KoochTableCell>{hasChanges ? <KoochButton type="button" variant="outline" size="sm"
        aria-expanded={expanded} aria-controls={expanded ? detailId : undefined} onClick={() => setExpanded((current) => !current)}
        leftIcon={<KoochIcon name="audit" className="h-4 w-4" />} rightIcon={<svg aria-hidden="true" className={`h-4 w-4 transition-transform ${expanded ? "rotate-180" : ""}`} viewBox="0 0 20 20" fill="none"><path d="m5 7.5 5 5 5-5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg>}>
        {expanded ? "بستن تغییرات" : "نمایش تغییرات"}
      </KoochButton> : <span className="text-muted-foreground">مقادیر قبل و بعد ثبت نشده‌اند.</span>}</KoochTableCell>
    </KoochTableRow>
    {expanded && <KoochTableRow className="bg-muted/50 hover:bg-muted/50">
      <KoochTableCell colSpan={5} id={detailId} className="border-y border-border px-4 py-4 align-top">
        <div className="min-w-0 max-w-full overflow-x-auto"><Changes row={row} /></div>
      </KoochTableCell>
    </KoochTableRow>}
  </>;
}

export default function AdminActivityHistoryPage() {
  const { authenticated, loading: sessionLoading, workspaces, platformRole, platformPermissions, user } = useAuthSession();
  const canRead = !sessionLoading && authenticated && workspaces.includes("admin") &&
    (platformRole === "SuperAdmin" || platformPermissions.includes("ViewReports"));
  const [filters, setFilters] = useState<AuditFilters>(emptyAuditFilters);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [result, setResult] = useState<AdminAuditPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [forbidden, setForbidden] = useState(false);
  const [retry, setRetry] = useState(0);
  const invalidDates = Boolean(filters.from && filters.to && filters.from > filters.to);
  const hasFilters = Object.values(filters).some(Boolean);

  function changeFilters(changes: Partial<AuditFilters>) {
    if (Object.keys(changes).every((key) => filters[key as keyof AuditFilters] === changes[key as keyof AuditFilters])) return;
    setFilters((current) => ({ ...current, ...changes }));
    setPage(1);
    setResult(null);
    setLoading(true);
  }

  useEffect(() => {
    setResult(null);
    if (!canRead || invalidDates) { setLoading(false); return; }
    let active = true;
    const controller = new AbortController();
    setLoading(true); setError(""); setForbidden(false);
    const timer = window.setTimeout(() => {
      apiRequest<AdminAuditPage>(adminAuditPath(filters, page, pageSize), { signal: controller.signal })
        .then((response) => { if (active) setResult(response); })
        .catch((reason: unknown) => {
          if (!active) return;
          setForbidden(reason instanceof ApiRequestError && reason.status === 403);
          setError(reason instanceof Error ? reason.message : "دریافت تاریخچه انجام نشد.");
        }).finally(() => { if (active) setLoading(false); });
    }, hasFilters ? 150 : 0);
    return () => { active = false; window.clearTimeout(timer); controller.abort(); };
  }, [canRead, user?.userId, filters, page, pageSize, retry, invalidDates, hasFilters]);

  return <AdminLayout requiredPlatformPermission="ViewReports">
    <main className="mx-auto grid max-w-[1480px] gap-5 p-4 lg:p-6" dir="rtl">
      <KoochPageHeader appearance="plain" eyebrow={null} title="تاریخچه فعالیت‌ها" description="رویدادهای ثبت‌شده در سراسر سامانه و مقادیر مجاز قبل و بعد از تغییر" />
      {!canRead ? <KoochAlert variant="warning">برای مشاهده تاریخچه به دسترسی گزارش‌ها نیاز دارید.</KoochAlert> : <>
        <KoochCard>
          <div className="grid items-end gap-4 sm:grid-cols-2 xl:grid-cols-[repeat(5,minmax(0,1fr))_auto]" aria-label="فیلتر تاریخچه">
            <AuditFilterSelect kind="actors" label="کاربر" value={filters.actor} enabled={canRead} onChange={(actor) => changeFilters({ actor })} />
            <AuditFilterSelect kind="properties" label="اقامتگاه" value={filters.property} enabled={canRead} onChange={(property) => changeFilters({ property })} />
            <KoochField label="عملیات"><KoochSelect value={filters.action} onChange={(event) => changeFilters({ action: event.target.value })}>
              <option value="">همه عملیات</option>{Object.entries(auditActionLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </KoochSelect></KoochField>
            <KoochDatePicker mode="single" label="از تاریخ" size="compact" autoConfirmOnSelect value={filters.from} onChange={(from) => changeFilters({ from })} />
            <KoochDatePicker mode="single" label="تا تاریخ" size="compact" autoConfirmOnSelect value={filters.to} onChange={(to) => changeFilters({ to })} />
            <KoochButton type="button" variant="outline" size="icon" aria-label="پاک کردن فیلترها" title="پاک کردن فیلترها" disabled={!hasFilters}
              onClick={() => changeFilters(emptyAuditFilters)} className="sm:justify-self-start xl:justify-self-auto">
              <KoochIcon name="close" className="h-4 w-4" />
            </KoochButton>
          </div>
          {invalidDates && <p className="mt-3 text-sm text-destructive" role="alert">تاریخ پایان نباید پیش از تاریخ شروع باشد.</p>}
        </KoochCard>
        {invalidDates ? null : error ? <KoochAlert variant={forbidden ? "warning" : "destructive"} title={forbidden ? "دسترسی به تاریخچه ندارید" : "تاریخچه بارگذاری نشد"}>
          <p>{forbidden ? "مجوز مشاهده گزارش‌ها برای حساب شما تأیید نشد." : error}</p>
          {!forbidden && <KoochButton variant="outline" className="mt-3" onClick={() => setRetry((value) => value + 1)}>تلاش دوباره</KoochButton>}
        </KoochAlert> : <KoochCard padding="none">
          <KoochTable><KoochTableHeader><KoochTableRow>
            <KoochTableHead>کاربر</KoochTableHead><KoochTableHead>زمان</KoochTableHead><KoochTableHead>عملیات</KoochTableHead>
            <KoochTableHead>هدف</KoochTableHead><KoochTableHead>تغییرات</KoochTableHead>
          </KoochTableRow></KoochTableHeader><KoochTableBody>
            {loading ? <KoochTableEmpty colSpan={5}><span role="status">در حال دریافت تاریخچه…</span></KoochTableEmpty> : !result?.items.length ?
              <KoochTableEmpty colSpan={5}>رویدادی با این فیلترها ثبت نشده است.</KoochTableEmpty> : result.items.map((row) => <AuditRow key={row.id} row={row} />)}
          </KoochTableBody></KoochTable>
          {result && !loading && <nav aria-label="صفحه‌بندی تاریخچه" className="flex flex-wrap items-center justify-between gap-3 border-t border-border p-4">
            <p className="text-sm text-muted-foreground">{formatNumber(result.totalCount)} رویداد · صفحه {formatNumber(result.page)} از {formatNumber(Math.max(1, result.totalPages))}</p>
            <div className="flex flex-wrap items-center gap-2">
              <KoochSelect aria-label="تعداد در صفحه" value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value)); setPage(1); }} className="w-auto">
                {[25, 50, 100].map((size) => <option key={size} value={size}>{formatNumber(size)} در صفحه</option>)}
              </KoochSelect>
              <KoochButton variant="outline" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>قبلی</KoochButton>
              <KoochButton variant="outline" disabled={page >= result.totalPages} onClick={() => setPage((value) => value + 1)}>بعدی</KoochButton>
            </div>
          </nav>}
        </KoochCard>}
      </>}
    </main>
  </AdminLayout>;
}
