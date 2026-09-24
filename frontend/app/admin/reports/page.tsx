"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AdminLayout } from "@/components/dashboard/DashboardLayouts";
import { KoochPageHeader } from "@/components/KoochPageHeader";
import { KoochCard } from "@/components/KoochCard";
import { KoochButton } from "@/components/KoochButton";
import { KoochAlert } from "@/components/KoochAlert";
import { KoochDatePicker } from "@/components/KoochDatePicker";
import { KoochField, KoochMultiSelect, KoochSelect } from "@/components/KoochFormControls";
import { KoochTable, KoochTableHeader, KoochTableHead, KoochTableBody, KoochTableRow, KoochTableCell } from "@/components/KoochTable";
import { AdminReportChart } from "@/components/admin/AdminReportChart";
import { apiRequest } from "@/lib/owner-api";
import { statusLabels } from "@/lib/account-reservations";
import {
  buildAdminReservationReportPath,
  type AdminReservationReport,
  type AdminReservationReportFilters,
  type ReportPropertyType,
  type ReportStatus,
} from "@/lib/admin-reports";
import {
  formatLocalIsoDate,
  getCurrentJalaliPeriodRange,
  type CurrentJalaliPeriod,
} from "@/lib/date-utils";

const statuses: ReportStatus[] = ["Pending", "PendingApproval", "ApprovedAwaitingPayment", "Confirmed", "Paid", "Completed", "Cancelled", "Rejected", "PaymentExpired", "Draft", "CapacityLost"];
const labels: Record<string, string> = { ...statusLabels, Draft: "پیش‌نویس", CapacityLost: "ظرفیت از دست رفته" };
const propertyTypeOptions: { value: ReportPropertyType; label: string }[] = [
  { value: "TraditionalHouse", label: "خانه سنتی" },
  { value: "BoutiqueHotel", label: "هتل بوتیک" },
  { value: "EcoLodge", label: "اقامتگاه بوم‌گردی" },
  { value: "Hotel", label: "هتل" },
  { value: "Villa", label: "ویلا" },
  { value: "Apartment", label: "آپارتمان" },
];
const emptyFilters: AdminReservationReportFilters = {
  startDate: null as string | null,
  endDate: null as string | null,
  propertyIds: [] as string[],
  propertyTypes: [],
  status: "",
};
const number = (value: number) => value.toLocaleString("fa-IR");
const amount = (value: number) => value.toLocaleString("fa-IR", { maximumFractionDigits: 20 });
const date = (value: string) => new Intl.DateTimeFormat("fa-IR", { timeZone: "UTC", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(`${value}T00:00:00Z`));
const currency = (value: string | null) => value === "IRR" ? "ریال" : value;
type ReportView = "chart" | "table";

function ReportViewSwitch({
  value,
  onChange,
  label,
}: {
  value: ReportView;
  onChange: (value: ReportView) => void;
  label: string;
}) {
  return (
    <div className="inline-flex rounded-lg border border-border bg-muted p-0.5" role="group" aria-label={label}>
      <KoochButton
        size="sm"
        variant="ghost"
        aria-pressed={value === "chart"}
        className={value === "chart" ? "min-w-16 bg-background text-primary shadow-sm ring-1 ring-inset ring-[var(--theme-primary-border)] hover:bg-background" : "min-w-16 text-muted-foreground hover:text-foreground"}
        onClick={() => onChange("chart")}
      >
        نمودار
      </KoochButton>
      <KoochButton
        size="sm"
        variant="ghost"
        aria-pressed={value === "table"}
        className={value === "table" ? "min-w-16 bg-background text-primary shadow-sm ring-1 ring-inset ring-[var(--theme-primary-border)] hover:bg-background" : "min-w-16 text-muted-foreground hover:text-foreground"}
        onClick={() => onChange("table")}
      >
        جدول
      </KoochButton>
    </div>
  );
}

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
  const [trendView, setTrendView] = useState<ReportView>("chart");
  const [propertyView, setPropertyView] = useState<ReportView>("chart");
  const today = formatLocalIsoDate(new Date());

  useEffect(() => {
    let current = true;
    setLoading(true);
    setError("");
    apiRequest<AdminReservationReport>(buildAdminReservationReportPath(applied))
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

  const applyFilters = () => {
    setApplied({
      ...draft,
      endDate: draft.startDate ? (draft.endDate ?? today) : null,
    });
  };

  const applyPreset = (period: CurrentJalaliPeriod) => {
    const range = getCurrentJalaliPeriodRange(period);
    setDraft((previous) => ({ ...previous, ...range }));
  };

  return (
    <div className="min-w-0 space-y-5" dir="rtl">
      <KoochPageHeader appearance="plain" eyebrow={null} title="گزارش رزروها"
        breadcrumb={<><li><Link href="/admin">پنل مدیریت</Link></li><li aria-hidden="true">/</li><li aria-current="page">گزارش‌ها</li></>}
        description="تعداد رزروها بر اساس تاریخ ایجاد و وضعیت فعلی؛ هر رزرو یک بار شمرده می‌شود." />

      <KoochCard padding="md">
        <form className="space-y-3" aria-describedby="report-date-help" onSubmit={(event) => {
          event.preventDefault();
          if (!loading) applyFilters();
        }}>
          <div className="grid min-w-0 items-start gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <div className="flex min-w-0 flex-col">
              <KoochDatePicker mode="single" autoConfirmOnSelect
                value={draft.startDate} maxDate={today} label="از تاریخ"
                placeholder="انتخاب تاریخ شروع" labels={{ title: "انتخاب تاریخ شروع" }}
                onChange={(startDate) => setDraft((previous) => ({
                  ...previous,
                  startDate,
                  endDate:
                    startDate && (!previous.endDate || previous.endDate >= startDate)
                      ? previous.endDate
                      : null,
                }))} />
              {draft.startDate && (
                <KoochButton type="button" size="sm" variant="ghost" className="mt-1 px-1"
                  onClick={() => setDraft((previous) => ({ ...previous, startDate: null, endDate: null }))}>
                  پاک کردن از تاریخ
                </KoochButton>
              )}
            </div>
            <fieldset className="flex min-w-0 flex-col disabled:opacity-60" disabled={!draft.startDate}>
              <KoochDatePicker mode="single" autoConfirmOnSelect
                value={draft.endDate} minDate={draft.startDate ?? undefined}
                label="تا تاریخ"
                placeholder={draft.startDate ? "انتخاب تاریخ پایان" : "ابتدا تاریخ شروع را انتخاب کنید"}
                labels={{ title: "انتخاب تاریخ پایان" }}
                onChange={(endDate) => setDraft((previous) => ({ ...previous, endDate }))} />
              {draft.endDate && (
                <KoochButton type="button" size="sm" variant="ghost" className="mt-1 px-1"
                  onClick={() => setDraft((previous) => ({ ...previous, endDate: null }))}>
                  پاک کردن تا تاریخ
                </KoochButton>
              )}
            </fieldset>
            <KoochField label="اقامتگاه">
              <KoochMultiSelect value={draft.propertyIds} placeholder="همه اقامتگاه‌های مجاز"
                options={properties.map((property) => ({ value: String(property.id), label: property.name }))}
                searchPlaceholder="جست‌وجوی اقامتگاه..."
                selectAllText="انتخاب همه"
                clearText="حذف همه"
                onChange={(propertyIds) => setDraft((previous) => ({
                  ...previous,
                  propertyIds: propertyIds.map(String),
                }))} />
            </KoochField>
            <KoochField label="نوع اقامتگاه">
              <KoochMultiSelect
                value={draft.propertyTypes}
                placeholder="همه نوع‌ها"
                options={propertyTypeOptions}
                searchPlaceholder="جست‌وجوی نوع اقامتگاه..."
                selectAllText="انتخاب همه"
                clearText="حذف همه"
                onChange={(propertyTypes) => setDraft((previous) => ({
                  ...previous,
                  propertyTypes: propertyTypes.map(String) as ReportPropertyType[],
                }))}
              />
            </KoochField>
            <KoochField label="وضعیت رزرو">
              <KoochSelect value={draft.status} onChange={(event) => setDraft((previous) => ({
                ...previous,
                status: event.target.value as ReportStatus | "",
              }))}>
                <option value="">همه وضعیت‌ها</option>
                {statuses.map((status) => <option key={status} value={status}>{labels[status]}</option>)}
              </KoochSelect>
            </KoochField>
          </div>
          <div className="flex flex-wrap items-center gap-2" aria-label="بازه‌های سریع تاریخ">
            <span className="text-xs font-medium text-muted-foreground">بازه سریع:</span>
            <KoochButton type="button" size="sm" variant="outline" onClick={() => applyPreset("week")}>این هفته</KoochButton>
            <KoochButton type="button" size="sm" variant="outline" onClick={() => applyPreset("month")}>این ماه</KoochButton>
            <KoochButton type="button" size="sm" variant="outline" onClick={() => applyPreset("quarter")}>این فصل</KoochButton>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <span id="report-date-help" className="sr-only">اگر تاریخ پایان انتخاب نشود، امروز به‌عنوان پایان بازه اعمال می‌شود.</span>
            <div className="flex shrink-0 gap-2">
              <KoochButton type="submit" loading={loading}>اعمال فیلتر</KoochButton>
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
            <KoochCard>
              <h2 className="text-sm text-muted-foreground">ارزش رزروها</h2>
              <p className="mt-2 text-2xl font-semibold tabular-nums">
                {report.summary.bookingValueHasMixedCurrencies
                  ? "چند ارز"
                  : <>{amount(report.summary.bookingValue ?? 0)}{currency(report.summary.bookingValueCurrency) ? ` ${currency(report.summary.bookingValueCurrency)}` : ""}</>}
              </p>
            </KoochCard>
            {report.summary.statusCounts.map((item) => <KoochCard key={item.status}><h2 className="text-sm text-muted-foreground">{labels[item.status] ?? item.status}</h2><p className="mt-2 text-2xl font-semibold tabular-nums">{number(item.count)}</p></KoochCard>)}
          </div>
          {report.summary.totalCount === 0 ? <KoochCard role="status">رزروی مطابق این فیلترها یافت نشد.</KoochCard> : (
            <div className="grid min-w-0 gap-6 xl:grid-cols-2">
              <KoochCard className="min-w-0" padding="md">
                <section className="min-w-0 space-y-4" aria-labelledby="report-trend-title">
                  <div className="flex min-h-10 flex-wrap items-center justify-between gap-3">
                    <div>
                      <h2 id="report-trend-title" className="font-semibold">روند ایجاد رزروها</h2>
                      <p className="mt-1 text-xs text-muted-foreground">فقط روزهایی که رزرو ثبت شده نمایش داده می‌شوند.</p>
                    </div>
                    <ReportViewSwitch value={trendView} onChange={setTrendView} label="نوع نمایش روند ایجاد رزروها" />
                  </div>
                  {trendView === "chart" ? (
                    <AdminReportChart kind="trend" data={report.trend} formatDate={date} />
                  ) : (
                    <KoochTable style={{ minWidth: 0 }} aria-labelledby="report-trend-title">
                      <KoochTableHeader><KoochTableRow><KoochTableHead>تاریخ ایجاد</KoochTableHead><KoochTableHead>تعداد رزرو</KoochTableHead></KoochTableRow></KoochTableHeader>
                      <KoochTableBody>{report.trend.map((item) => <KoochTableRow key={item.date}><KoochTableCell>{date(item.date)}</KoochTableCell><KoochTableCell>{number(item.count)}</KoochTableCell></KoochTableRow>)}</KoochTableBody>
                    </KoochTable>
                  )}
                </section>
              </KoochCard>
              <KoochCard className="min-w-0" padding="md">
                <section className="min-w-0 space-y-4" aria-labelledby="report-properties-title">
                  <div className="flex min-h-10 flex-wrap items-center justify-between gap-3">
                    <h2 id="report-properties-title" className="font-semibold">تفکیک اقامتگاه</h2>
                    <ReportViewSwitch value={propertyView} onChange={setPropertyView} label="نوع نمایش تفکیک اقامتگاه" />
                  </div>
                  {propertyView === "chart" ? (
                    <AdminReportChart kind="properties" data={report.properties} />
                  ) : (
                    <KoochTable style={{ minWidth: 0 }} aria-labelledby="report-properties-title">
                      <KoochTableHeader><KoochTableRow><KoochTableHead>اقامتگاه</KoochTableHead><KoochTableHead>تعداد رزرو</KoochTableHead></KoochTableRow></KoochTableHeader>
                      <KoochTableBody>{report.properties.map((item) => <KoochTableRow key={item.propertyId}><KoochTableCell>{item.propertyName}</KoochTableCell><KoochTableCell>{number(item.count)}</KoochTableCell></KoochTableRow>)}</KoochTableBody>
                    </KoochTable>
                  )}
                </section>
              </KoochCard>
            </div>
          )}
        </>}
      </div>
    </div>
  );
}
