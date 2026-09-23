"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AdminLayout } from "@/components/dashboard/DashboardLayouts";
import { KoochPageHeader } from "@/components/KoochPageHeader";
import { KoochCard } from "@/components/KoochCard";
import { KoochButton } from "@/components/KoochButton";
import { KoochAlert } from "@/components/KoochAlert";
import { KoochDatePicker } from "@/components/KoochDatePicker";
import { KoochField, KoochSearchableSelect, KoochSelect } from "@/components/KoochFormControls";
import { KoochTable, KoochTableHeader, KoochTableHead, KoochTableBody, KoochTableRow, KoochTableCell } from "@/components/KoochTable";
import { apiRequest } from "@/lib/owner-api";
import { statusLabels } from "@/lib/account-reservations";
import type { AdminReservationReport, ReportStatus } from "@/lib/admin-reports";

const statuses: ReportStatus[] = ["Pending", "PendingApproval", "ApprovedAwaitingPayment", "Confirmed", "Paid", "Completed", "Cancelled", "Rejected", "PaymentExpired", "Draft", "CapacityLost"];
const labels: Record<string, string> = { ...statusLabels, Draft: "پیش‌نویس", CapacityLost: "ظرفیت از دست رفته" };
const emptyFilters = { startDate: null as string | null, endDate: null as string | null, propertyId: "", status: "" };
const number = (value: number) => value.toLocaleString("fa-IR");
const date = (value: string) => new Intl.DateTimeFormat("fa-IR", { timeZone: "UTC", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(`${value}T00:00:00Z`));

export default function AdminReportsPage() {
  return (
    <AdminLayout requiredPlatformPermission="ViewReports">
      <main className="mx-auto grid max-w-[1480px] gap-5 p-4 lg:p-6">
        <ReservationReport />
      </main>
    </AdminLayout>
  );
}

function ReservationReport() {
  const [draft, setDraft] = useState(emptyFilters);
  const [applied, setApplied] = useState(emptyFilters);
  const [report, setReport] = useState<AdminReservationReport | null>(null);
  const [properties, setProperties] = useState<AdminReservationReport["reportableProperties"]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let current = true;
    const params = new URLSearchParams();
    if (applied.startDate) params.set("from", applied.startDate);
    if (applied.endDate) params.set("to", applied.endDate);
    if (applied.propertyId) params.set("propertyId", applied.propertyId);
    if (applied.status) params.set("status", applied.status);
    setLoading(true);
    setError("");
    apiRequest<AdminReservationReport>(`/admin/reports/reservations${params.size ? `?${params}` : ""}`)
      .then((result) => {
        if (!current) return;
        setReport(result);
        setProperties(result.reportableProperties);
      })
      .catch((reason: unknown) => {
        if (!current) return;
        setError(reason instanceof Error ? reason.message : "دریافت گزارش انجام نشد.");
      })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [applied, retry]);

  const invalidRange = Boolean(draft.startDate && draft.endDate && draft.startDate > draft.endDate);

  return (
    <div className="min-w-0 space-y-5" dir="rtl">
      <KoochPageHeader appearance="plain" eyebrow={null} title="گزارش رزروها"
        breadcrumb={<><li><Link href="/admin">پنل مدیریت</Link></li><li aria-hidden="true">/</li><li aria-current="page">گزارش‌ها</li></>}
        description="تعداد رزروها بر اساس تاریخ ایجاد و وضعیت فعلی؛ هر رزرو یک بار شمرده می‌شود." />

      <KoochCard padding="md">
        <form className="space-y-3" onSubmit={(event) => {
          event.preventDefault();
          if (!invalidRange && !loading) setApplied({ ...draft });
        }}>
          <div className="grid min-w-0 gap-3 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)_minmax(0,0.8fr)]">
            <fieldset className="min-w-0 space-y-2" aria-invalid={invalidRange || undefined} aria-describedby={invalidRange ? "report-date-help report-date-error" : "report-date-help"}>
              <legend className="text-sm font-medium">بازه تاریخ ایجاد رزرو</legend>
              <KoochDatePicker mode="range" value={{ startDate: draft.startDate, endDate: draft.endDate }}
                onChange={(value) => setDraft((previous) => ({ ...previous, ...value }))}
                labels={{ start: "از تاریخ", end: "تا تاریخ", rangeTitle: "بازه تاریخ ایجاد رزرو" }} disablePastDates={false} openOnDialog />
              {invalidRange && <p id="report-date-error" role="alert" className="text-sm text-destructive">تاریخ پایان نباید قبل از شروع باشد.</p>}
            </fieldset>
            <KoochField label="اقامتگاه">
              <KoochSearchableSelect value={draft.propertyId} placeholder="همه اقامتگاه‌های مجاز"
                options={properties.map((property) => ({ value: String(property.id), label: property.name }))}
                onChange={(propertyId) => setDraft((previous) => ({ ...previous, propertyId }))} />
            </KoochField>
            <KoochField label="وضعیت رزرو">
              <KoochSelect value={draft.status} onChange={(event) => setDraft((previous) => ({ ...previous, status: event.target.value }))}>
                <option value="">همه وضعیت‌ها</option>
                {statuses.map((status) => <option key={status} value={status}>{labels[status]}</option>)}
              </KoochSelect>
            </KoochField>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <span id="report-date-help" className="sr-only">هر دو تاریخ انتخاب‌شده در گزارش لحاظ می‌شوند.</span>
            <div className="flex shrink-0 gap-2">
              <KoochButton type="submit" loading={loading} disabled={invalidRange}>اعمال فیلتر</KoochButton>
              <KoochButton type="button" variant="outline" disabled={loading} onClick={() => { setDraft(emptyFilters); setApplied({ ...emptyFilters }); }}>پاک کردن فیلترها</KoochButton>
            </div>
          </div>
        </form>
      </KoochCard>

      <div aria-busy={loading} className="space-y-6">
        {loading ? <KoochCard role="status">در حال دریافت گزارش…</KoochCard> : error ? (
          <KoochAlert variant="destructive" title="گزارش دریافت نشد">
            <p>{error}</p><KoochButton variant="outline" className="mt-3" onClick={() => setRetry((value) => value + 1)}>تلاش دوباره</KoochButton>
          </KoochAlert>
        ) : report && <>
          <p className="text-sm text-muted-foreground">بازه گزارش: {report.filters.from ? date(report.filters.from) : "از ابتدا"} تا {report.filters.to ? date(report.filters.to) : "اکنون"}</p>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="خلاصه گزارش">
            <KoochCard><h2 className="text-sm text-muted-foreground">کل رزروها</h2><p className="mt-2 text-2xl font-semibold tabular-nums">{number(report.summary.totalCount)}</p></KoochCard>
            {report.summary.statusCounts.map((item) => <KoochCard key={item.status}><h2 className="text-sm text-muted-foreground">{labels[item.status] ?? item.status}</h2><p className="mt-2 text-2xl font-semibold tabular-nums">{number(item.count)}</p></KoochCard>)}
          </div>
          {report.summary.totalCount === 0 ? <KoochCard role="status">رزروی مطابق این فیلترها یافت نشد.</KoochCard> : (
            <div className="grid min-w-0 gap-6 xl:grid-cols-2">
              <KoochCard className="min-w-0" padding="md">
                <section className="min-w-0 space-y-3" aria-labelledby="report-trend-title">
                  <div>
                    <h2 id="report-trend-title" className="font-semibold">روند ایجاد رزروها</h2>
                    <p className="mt-1 text-xs text-muted-foreground">فقط روزهایی که رزرو ثبت شده نمایش داده می‌شوند.</p>
                  </div>
                  <KoochTable style={{ minWidth: 0 }} aria-labelledby="report-trend-title">
                    <KoochTableHeader><KoochTableRow><KoochTableHead>تاریخ ایجاد</KoochTableHead><KoochTableHead>تعداد رزرو</KoochTableHead></KoochTableRow></KoochTableHeader>
                    <KoochTableBody>{report.trend.map((item) => <KoochTableRow key={item.date}><KoochTableCell>{date(item.date)}</KoochTableCell><KoochTableCell>{number(item.count)}</KoochTableCell></KoochTableRow>)}</KoochTableBody>
                  </KoochTable>
                </section>
              </KoochCard>
              <KoochCard className="min-w-0" padding="md">
                <section className="min-w-0 space-y-3" aria-labelledby="report-properties-title">
                  <h2 id="report-properties-title" className="font-semibold">تفکیک اقامتگاه</h2>
                  <KoochTable style={{ minWidth: 0 }} aria-labelledby="report-properties-title">
                    <KoochTableHeader><KoochTableRow><KoochTableHead>اقامتگاه</KoochTableHead><KoochTableHead>تعداد رزرو</KoochTableHead></KoochTableRow></KoochTableHeader>
                    <KoochTableBody>{report.properties.map((item) => <KoochTableRow key={item.propertyId}><KoochTableCell>{item.propertyName}</KoochTableCell><KoochTableCell>{number(item.count)}</KoochTableCell></KoochTableRow>)}</KoochTableBody>
                  </KoochTable>
                </section>
              </KoochCard>
            </div>
          )}
        </>}
      </div>
    </div>
  );
}
