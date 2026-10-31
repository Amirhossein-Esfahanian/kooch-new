"use client";

import Link from "next/link";
import { PriceAuditDetails } from "./PriceAuditDetails";
import { useEffect, useState, type FormEvent } from "react";
import { useAuthSession } from "@/components/auth/AuthSessionProvider";
import { AdminLayout } from "@/components/dashboard/DashboardLayouts";
import { KoochAlert } from "@/components/KoochAlert";
import { KoochButton } from "@/components/KoochButton";
import { KoochCard } from "@/components/KoochCard";
import { KoochDatePicker } from "@/components/KoochDatePicker";
import { KoochField, KoochInput, KoochSelect } from "@/components/KoochFormControls";
import { KoochPageHeader } from "@/components/KoochPageHeader";
import { KoochTable, KoochTableBody, KoochTableCell, KoochTableEmpty, KoochTableHead, KoochTableHeader, KoochTableRow } from "@/components/KoochTable";
import { apiRequest, ApiRequestError } from "@/lib/owner-api";
import { formatDateTime, formatNumber } from "@/lib/account-reservations";
import { toLatinDigits } from "@/lib/persian-digits";
import { adminAuditPath, auditActionLabels, auditFieldLabels, auditValue, emptyAuditFilters, type AdminAuditPage, type AuditFilters, type AdminAuditLog } from "@/lib/admin-audit-logs";

const entityLabels: Record<string, string> = { Property: "اقامتگاه", RoomType: "نوع اتاق", Availability: "موجودی اتاق", RoomDailyPrice: "قیمت روزانه", SiteSetting: "تنظیمات سایت", CashbackSetting: "تنظیمات کش‌بک", Reservation: "رزرو", User: "کاربر" };

function Changes({ row }: { row: AdminAuditLog }) {
  if (row.hasPriceDetails) return <PriceAuditDetails key={row.id} row={row} />;
  const keys = [...new Set([...Object.keys(row.previousValues ?? {}), ...Object.keys(row.newValues ?? {})])]
    .filter((key) => Object.hasOwn(auditFieldLabels, key));
  if (!keys.length) return <span className="text-muted-foreground">مقادیر قبل و بعد ثبت نشده‌اند.</span>;
  return <details>
    <summary className="cursor-pointer rounded-lg py-2 font-medium text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">مشاهده تغییرات</summary>
    <dl className="mt-2 grid min-w-56 gap-3">
      {keys.map((key) => <div key={key}>
        <dt className="font-medium">{auditFieldLabels[key]}</dt>
        <dd className="mt-1 break-words"><span className="text-muted-foreground">قبل: </span>{auditValue(row.previousValues?.[key])}</dd>
        <dd className="break-words"><span className="text-muted-foreground">بعد: </span>{auditValue(row.newValues?.[key])}</dd>
      </div>)}
    </dl>
    {row.action === "PriceChanged" && row.entityType === "RoomDailyPrice" && row.propertyId &&
      <Link href={`/admin/properties/${row.propertyId}/pricing`} className="mt-3 inline-block text-primary underline-offset-4 hover:underline">مشاهده تاریخچه قیمت اتاق‌ها</Link>}
  </details>;
}

export default function AdminActivityHistoryPage() {
  const { authenticated, loading: sessionLoading, workspaces, platformRole, platformPermissions, user } = useAuthSession();
  const canRead = !sessionLoading && authenticated && workspaces.includes("admin") &&
    (platformRole === "SuperAdmin" || platformPermissions.includes("ViewReports"));
  const [draft, setDraft] = useState<AuditFilters>(emptyAuditFilters);
  const [filters, setFilters] = useState<AuditFilters>(emptyAuditFilters);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [result, setResult] = useState<AdminAuditPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [forbidden, setForbidden] = useState(false);
  const [validation, setValidation] = useState("");
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    setResult(null);
    if (!canRead) return;
    let active = true;
    const controller = new AbortController();
    setLoading(true); setError(""); setForbidden(false);
    apiRequest<AdminAuditPage>(adminAuditPath(filters, page, pageSize), { signal: controller.signal })
      .then((response) => { if (active) setResult(response); })
      .catch((reason: unknown) => {
        if (!active) return;
        setForbidden(reason instanceof ApiRequestError && reason.status === 403);
        setError(reason instanceof Error ? reason.message : "دریافت تاریخچه انجام نشد.");
      }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; controller.abort(); };
  }, [canRead, user?.userId, filters, page, pageSize, retry]);

  function apply(event: FormEvent) {
    event.preventDefault();
    if ([draft.actor, draft.property].some((value) => value && (!/^[1-9]\d*$/.test(value) || Number(value) > 2147483647))) {
      setValidation("شناسه باید یک عدد صحیح مثبت باشد."); return;
    }
    if (draft.from && draft.to && draft.from > draft.to) {
      setValidation("تاریخ پایان نباید پیش از تاریخ شروع باشد."); return;
    }
    setValidation(""); setPage(1); setFilters({ ...draft });
  }

  return <AdminLayout requiredPlatformPermission="ViewReports">
    <main className="mx-auto grid max-w-[1480px] gap-5 p-4 lg:p-6" dir="rtl">
      <KoochPageHeader appearance="plain" eyebrow={null} title="تاریخچه فعالیت‌ها" description="رویدادهای ثبت‌شده در سراسر سامانه و مقادیر مجاز قبل و بعد از تغییر" />
      {!canRead ? <KoochAlert variant="warning">برای مشاهده تاریخچه به دسترسی گزارش‌ها نیاز دارید.</KoochAlert> : <>
        <KoochCard>
          <form onSubmit={apply} className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5" aria-label="فیلتر تاریخچه">
            <KoochField label="شناسه کاربر"><KoochInput inputMode="numeric" value={draft.actor} onChange={(event) => setDraft({ ...draft, actor: toLatinDigits(event.target.value).trim() })} /></KoochField>
            <KoochField label="شناسه اقامتگاه"><KoochInput inputMode="numeric" value={draft.property} onChange={(event) => setDraft({ ...draft, property: toLatinDigits(event.target.value).trim() })} /></KoochField>
            <KoochField label="عملیات"><KoochSelect value={draft.action} onChange={(event) => setDraft({ ...draft, action: event.target.value })}>
              <option value="">همه عملیات</option>{Object.entries(auditActionLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </KoochSelect></KoochField>
            <KoochDatePicker mode="single" label="از تاریخ" size="compact" autoConfirmOnSelect value={draft.from} onChange={(from) => setDraft({ ...draft, from })} />
            <KoochDatePicker mode="single" label="تا تاریخ" size="compact" autoConfirmOnSelect value={draft.to} onChange={(to) => setDraft({ ...draft, to })} />
            <div className="flex flex-wrap gap-2 sm:col-span-2 xl:col-span-5">
              <KoochButton type="submit">اعمال فیلتر</KoochButton>
              <KoochButton variant="outline" onClick={() => { setDraft(emptyAuditFilters); setFilters(emptyAuditFilters); setPage(1); setValidation(""); }}>پاک کردن فیلترها</KoochButton>
            </div>
            {validation && <p className="text-sm text-destructive sm:col-span-2 xl:col-span-5" role="alert">{validation}</p>}
          </form>
          <p className="mt-3 text-sm text-muted-foreground">روزهای فیلتر بر اساس ساعت تهران محاسبه می‌شوند. زمان رویداد به وقت دستگاه شما نمایش داده می‌شود.</p>
        </KoochCard>
        {error ? <KoochAlert variant={forbidden ? "warning" : "destructive"} title={forbidden ? "دسترسی به تاریخچه ندارید" : "تاریخچه بارگذاری نشد"}>
          <p>{forbidden ? "مجوز مشاهده گزارش‌ها برای حساب شما تأیید نشد." : error}</p>
          {!forbidden && <KoochButton variant="outline" className="mt-3" onClick={() => setRetry((value) => value + 1)}>تلاش دوباره</KoochButton>}
        </KoochAlert> : <KoochCard padding="none">
          <KoochTable><KoochTableHeader><KoochTableRow>
            <KoochTableHead>کاربر</KoochTableHead><KoochTableHead>زمان</KoochTableHead><KoochTableHead>عملیات</KoochTableHead>
            <KoochTableHead>هدف</KoochTableHead><KoochTableHead>تغییرات</KoochTableHead>
          </KoochTableRow></KoochTableHeader><KoochTableBody>
            {loading ? <KoochTableEmpty colSpan={5}><span role="status">در حال دریافت تاریخچه…</span></KoochTableEmpty> : !result?.items.length ?
              <KoochTableEmpty colSpan={5}>رویدادی با این فیلترها ثبت نشده است.</KoochTableEmpty> : result.items.map((row) => <KoochTableRow key={row.id}>
                <KoochTableCell><p>{row.actorDisplayName}</p><p className="text-xs text-muted-foreground">شناسه {formatNumber(row.userId)}</p></KoochTableCell>
                <KoochTableCell className="whitespace-nowrap"><time dateTime={row.occurredAtUtc} title={row.occurredAtUtc}>{row.hasPriceDetails ? new Intl.DateTimeFormat("fa-IR", { dateStyle: "short", timeStyle: "medium" }).format(new Date(row.occurredAtUtc)) : formatDateTime(row.occurredAtUtc)}</time></KoochTableCell>
                <KoochTableCell>{auditActionLabels[row.action] ?? "رویداد ثبت‌شده"}</KoochTableCell>
                <KoochTableCell><p>{row.entityName ?? entityLabels[row.entityType] ?? "مورد ثبت‌شده"}{row.entityId ? ` · ${formatNumber(row.entityId)}` : ""}</p><p className="text-sm text-muted-foreground">{row.propertyName ?? "سطح سامانه"}</p>{row.propertyId && <p className="text-xs text-muted-foreground">شناسه اقامتگاه {formatNumber(row.propertyId)}</p>}</KoochTableCell>
                <KoochTableCell><Changes row={row} /></KoochTableCell>
              </KoochTableRow>)}
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
