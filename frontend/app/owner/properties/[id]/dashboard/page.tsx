"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useAuthSession } from "@/components/auth/AuthSessionProvider";
import { OwnerLayout } from "@/components/dashboard/DashboardLayouts";
import { KoochAlert } from "@/components/KoochAlert";
import { KoochButton } from "@/components/KoochButton";
import { KoochCard } from "@/components/KoochCard";
import { KoochPageHeader } from "@/components/KoochPageHeader";
import { useOwnerProperty } from "@/components/owner/OwnerPropertyProvider";
import { formatBookingDate } from "@/components/booking/booking-display";
import { PropertyCompletionCard } from "@/components/property/PropertyCompletionCard";
import {
  getPropertyFinancialWarnings,
  PricingSettingsWarning,
} from "@/components/pricing/PricingWarnings";
import {
  apiRequest,
  ApiRequestError,
  PropertyCompletionResponse,
  PropertyResponse,
  RoomTypeResponse,
} from "@/lib/owner-api";
import { propertyCompletionHref } from "@/lib/property-completion";
import { canViewOwnerMenuItem } from "@/lib/property-menu-permissions";
import { parseLocalIsoDate } from "@/lib/date-utils";

interface OwnerOperationalSummary {
  businessDate: string;
  pendingApprovalCount: number;
  scheduledArrivalsTodayCount: number;
  scheduledDeparturesTodayCount: number;
}

type SummaryState =
  | { propertyId: number; status: "loading" }
  | { propertyId: number; status: "ready"; data: OwnerOperationalSummary }
  | { propertyId: number; status: "error" | "forbidden" };

type OverviewState =
  | { propertyId: number; status: "loading" }
  | { propertyId: number; status: "ready"; property: PropertyResponse; completion: PropertyCompletionResponse; roomTypes: RoomTypeResponse[] }
  | { propertyId: number; status: "error" | "forbidden" };

interface OwnerVisitAnalytics {
  businessDate: string;
  todayRecordedVisits: number;
  last7DaysTotal: number;
  last30DaysTotal: number;
  last90DaysTotal: number;
  dailyVisits: { businessDate: string; recordedVisits: number }[];
}

type VisitPeriod = 7 | 30 | 90;
type VisitState =
  | { propertyId: number; status: "loading" }
  | { propertyId: number; status: "ready"; data: OwnerVisitAnalytics }
  | { propertyId: number; status: "error" | "forbidden" };

const visitPeriods: { days: VisitPeriod; label: string }[] = [
  { days: 7, label: "۷ روز گذشته" },
  { days: 30, label: "۳۰ روز گذشته" },
  { days: 90, label: "۹۰ روز گذشته" },
];

const formatTrendDate = (value: string) =>
  new Intl.DateTimeFormat("fa-IR-u-ca-persian-nu-arabext", {
    month: "short", day: "numeric",
  }).format(parseLocalIsoDate(value));

const formatCount = (value: number) => new Intl.NumberFormat("fa-IR").format(value);

const linkButtonClass =
  "inline-flex min-h-10 items-center justify-center rounded-md border px-4 py-2 text-sm font-semibold transition focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-background";

const statusLabels: Record<PropertyResponse["status"], string> = {
  Draft: "پیش‌نویس",
  PendingReview: "در انتظار بررسی",
  Approved: "تأیید شده",
  Rejected: "رد شده",
  Suspended: "تعلیق شده",
};

export default function OwnerPropertyDashboardPage() {
  const params = useParams<{ id: string }>();
  const propertyId = Number(params.id);
  const { authenticated, loading, workspaces } = useAuthSession();
  const isOwnerWorkspace = workspaces.includes("owner");
  const { effectivePermissions, routePropertyIsValid } = useOwnerProperty();
  const canViewBookings = routePropertyIsValid &&
    canViewOwnerMenuItem(effectivePermissions, "Bookings");
  const canViewReports = routePropertyIsValid &&
    canViewOwnerMenuItem(effectivePermissions, "Reports");
  const canViewRooms = routePropertyIsValid &&
    canViewOwnerMenuItem(effectivePermissions, "Rooms");
  const [overviewState, setOverviewState] = useState<OverviewState | null>(null);
  const [overviewRetry, setOverviewRetry] = useState(0);

  useEffect(() => {
    if (loading || !authenticated || !isOwnerWorkspace || !routePropertyIsValid || !Number.isInteger(propertyId) || propertyId <= 0) return;
    const controller = new AbortController();
    setOverviewState({ propertyId, status: "loading" });

    Promise.all([
      apiRequest<PropertyResponse>(`/owner/properties/${propertyId}`, { signal: controller.signal }),
      apiRequest<PropertyCompletionResponse>(
        `/owner/properties/${propertyId}/completion`,
        { signal: controller.signal },
      ),
      apiRequest<RoomTypeResponse[]>(
        `/owner/properties/${propertyId}/room-types`,
        { signal: controller.signal },
      ),
    ])
      .then(([propertyResult, completionResult, roomTypesResult]) => {
        if (controller.signal.aborted) return;
        setOverviewState({ propertyId, status: "ready", property: propertyResult, completion: completionResult, roomTypes: roomTypesResult });
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return;
        setOverviewState({
          propertyId,
          status: reason instanceof ApiRequestError && reason.status === 403 ? "forbidden" : "error",
        });
      });
    return () => controller.abort();
  }, [authenticated, loading, propertyId, routePropertyIsValid, overviewRetry, isOwnerWorkspace]);

  const currentOverview = overviewState?.propertyId === propertyId ? overviewState : null;
  const overview = currentOverview?.status === "ready" ? currentOverview : null;
  const property = overview?.property;
  const quickActions = [
    { label: "قیمت‌گذاری", description: "مدیریت قیمت اتاق‌ها", permission: "Pricing" as const, href: `/owner/properties/${propertyId}/pricing` },
    { label: "ظرفیت و موجودی", description: "تقویم ظرفیت و دسترسی", permission: "Inventory" as const, href: `/owner/properties/${propertyId}/inventory` },
    { label: "رزروها", description: "بررسی و پیگیری رزروها", permission: "Bookings" as const, href: `/owner/properties/${propertyId}/reservations` },
    { label: "اتاق‌ها", description: "مدیریت نوع اتاق‌ها", permission: "Rooms" as const, href: `/owner/properties/${propertyId}/rooms` },
  ].filter((action) => routePropertyIsValid && canViewOwnerMenuItem(effectivePermissions, action.permission));

  return (
    <OwnerLayout>
      <main className="mx-auto grid max-w-[1480px] gap-6 p-4 lg:p-6" dir="rtl">
        <KoochPageHeader
          actions={
            <>
              <Link
                className={`${linkButtonClass} border-border bg-background text-foreground hover:bg-muted`}
                href="/owner/select-property"
              >
                تغییر اقامتگاه
              </Link>
              {property?.slug && (
                <Link
                  className={`${linkButtonClass} border-primary bg-primary text-primary-foreground hover:bg-[var(--primary-hover)]`}
                  href={`/properties/${property.slug}`}
                >
                  مشاهده صفحه عمومی
                </Link>
              )}
            </>
          }
          description={property ? <>{property.city && <span>{property.city} · </span>}<span>وضعیت: {statusLabels[property.status] ?? property.status}</span></> : "نمای کلی اقامتگاه و فعالیت‌های امروز"}
          eyebrow="داشبورد اقامتگاه"
          title={property?.name ?? "داشبورد اقامتگاه"}
        />

        {currentOverview?.status === "loading" && (
          <KoochCard aria-label="در حال دریافت اطلاعات اقامتگاه" role="status" padding="sm">
            <div aria-hidden="true" className="grid gap-3 sm:grid-cols-2">
              <div className="h-16 rounded-lg bg-muted motion-safe:animate-pulse" />
              <div className="h-16 rounded-lg bg-muted motion-safe:animate-pulse" />
            </div>
          </KoochCard>
        )}
        {currentOverview?.status === "forbidden" && (
          <KoochAlert title="دسترسی به اطلاعات این اقامتگاه ندارید" variant="warning">
            اطلاعات اقامتگاه و نوع اتاق‌ها نمایش داده نمی‌شود.
          </KoochAlert>
        )}
        {currentOverview?.status === "error" && (
          <KoochAlert title="دریافت اطلاعات اقامتگاه انجام نشد" variant="destructive">
            <KoochButton className="mt-3" onClick={() => setOverviewRetry((value) => value + 1)} variant="outline">تلاش دوباره</KoochButton>
          </KoochAlert>
        )}

        {canViewBookings && authenticated && !loading && isOwnerWorkspace && (
          <OwnerOperationalSummarySection propertyId={propertyId} />
        )}

        {canViewRooms && overview && (
          <section aria-label="نوع اتاق‌های فعال">
            <KoochCard className="sm:max-w-xs" padding="sm">
              <p className="text-sm text-muted-foreground">نوع اتاق‌های فعال</p>
              <p className="mt-2 text-2xl font-semibold tabular-nums text-foreground">
                {formatCount(overview.roomTypes.filter((roomType) => roomType.isActive).length)}
              </p>
            </KoochCard>
          </section>
        )}

        {quickActions.length > 0 && (
          <section aria-labelledby="owner-quick-actions-title" className="grid gap-3">
            <h2 id="owner-quick-actions-title" className="text-lg font-semibold text-foreground">کارهای سریع</h2>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {quickActions.map((action) => (
                <Link className="group min-w-0 rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring" href={action.href} key={action.label}>
                  <KoochCard className="h-full transition-colors group-hover:border-primary group-focus-visible:border-primary" padding="sm">
                    <h3 className="text-sm font-semibold text-foreground">{action.label}</h3>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">{action.description}</p>
                  </KoochCard>
                </Link>
              ))}
            </div>
          </section>
        )}

        {overview && (
          <section aria-label="تکمیل و راه‌اندازی اقامتگاه" className="grid gap-3">
            <PricingSettingsWarning
              editHref={`/owner/properties/${propertyId}?step=7`}
              warnings={getPropertyFinancialWarnings(overview.property, overview.roomTypes)}
            />
            <PropertyCompletionCard
              completion={overview.completion}
              getActionHref={(section) => propertyCompletionHref("owner", propertyId, section)}
            />
          </section>
        )}

        {canViewReports && authenticated && !loading && isOwnerWorkspace && (
          <OwnerPropertyVisitAnalyticsSection propertyId={propertyId} />
        )}
      </main>
    </OwnerLayout>
  );
}

function OwnerPropertyVisitAnalyticsSection({ propertyId }: { propertyId: number }) {
  const [period, setPeriod] = useState<VisitPeriod>(30);
  const [state, setState] = useState<VisitState | null>(null);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    if (!Number.isInteger(propertyId) || propertyId <= 0) return;
    const controller = new AbortController();
    setState({ propertyId, status: "loading" });
    apiRequest<OwnerVisitAnalytics>(
      `/owner/properties/${propertyId}/visits/analytics`,
      { signal: controller.signal },
    )
      .then((data) => {
        if (controller.signal.aborted) return;
        if (!Array.isArray(data?.dailyVisits)) {
          setState({ propertyId, status: "error" });
          return;
        }
        setState({ propertyId, status: "ready", data });
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return;
        setState({
          propertyId,
          status: reason instanceof ApiRequestError && (reason.status === 403 || reason.status === 404)
            ? "forbidden" : "error",
        });
      });
    return () => controller.abort();
  }, [propertyId, retry]);

  const current = state?.propertyId === propertyId ? state : null;
  const data = current?.status === "ready" ? current.data : null;
  const points = data?.dailyVisits.slice(-period) ?? [];
  const hasRecordedVisits = points.some((point) => point.recordedVisits > 0);

  return (
    <section aria-labelledby="owner-visit-analytics-title" className="grid gap-3" dir="rtl">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="owner-visit-analytics-title" className="text-lg font-semibold text-foreground">
            بازدیدهای ثبت‌شده
          </h2>
          {data && (
            <p className="mt-1 text-sm text-muted-foreground">
              امروز بر پایه تاریخ تهران: <time dateTime={data.businessDate}>{formatBookingDate(data.businessDate)}</time>
            </p>
          )}
        </div>
        {data && (
          <div aria-label="بازه نمایش بازدیدها" className="flex flex-wrap gap-2" role="group">
            {visitPeriods.map(({ days, label }) => (
              <KoochButton
                aria-pressed={period === days}
                key={days}
                onClick={() => setPeriod(days)}
                size="sm"
                variant={period === days ? "primary" : "outline"}
              >
                {label}
              </KoochButton>
            ))}
          </div>
        )}
      </div>

      {!current || current.status === "loading" ? (
        <KoochCard aria-label="در حال دریافت آمار بازدیدها" role="status">
          <div aria-hidden="true" className="grid gap-3 motion-safe:animate-pulse sm:grid-cols-2">
            <div className="h-16 rounded-lg bg-muted" />
            <div className="h-16 rounded-lg bg-muted" />
            <div className="h-56 rounded-lg bg-muted sm:col-span-2" />
          </div>
        </KoochCard>
      ) : current.status === "forbidden" ? (
        <KoochAlert title="دسترسی به آمار بازدیدهای این اقامتگاه ندارید" variant="warning">
          برای مشاهده این بخش به دسترسی گزارش‌های همین اقامتگاه نیاز دارید.
        </KoochAlert>
      ) : current.status === "error" ? (
        <KoochAlert title="دریافت آمار بازدیدها انجام نشد" variant="destructive">
          <p>سایر بخش‌های داشبورد همچنان در دسترس هستند.</p>
          <KoochButton className="mt-3" onClick={() => setRetry((value) => value + 1)} variant="outline">
            تلاش دوباره
          </KoochButton>
        </KoochAlert>
      ) : data ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <KoochCard aria-label="بازدیدهای ثبت‌شده امروز" padding="sm">
              <p className="text-sm text-muted-foreground">بازدیدهای ثبت‌شده امروز</p>
              <p className="mt-2 text-2xl font-semibold tabular-nums text-foreground">{formatCount(data.todayRecordedVisits)}</p>
            </KoochCard>
            <KoochCard aria-label="بازدیدهای ثبت‌شده در بازه انتخاب‌شده" padding="sm">
              <p className="text-sm text-muted-foreground">بازدیدهای ثبت‌شده در {visitPeriods.find((item) => item.days === period)?.label}</p>
              <p className="mt-2 text-2xl font-semibold tabular-nums text-foreground">
                {formatCount(period === 7 ? data.last7DaysTotal : period === 30 ? data.last30DaysTotal : data.last90DaysTotal)}
              </p>
            </KoochCard>
          </div>
          <KoochCard className="min-w-0" padding="sm">
            <h3 className="text-sm font-semibold text-foreground">روند روزانه بازدیدهای ثبت‌شده</h3>
            {points.length === 0 ? (
              <p className="mt-4 text-sm text-muted-foreground" role="status">داده‌ای برای نمایش نمودار وجود ندارد.</p>
            ) : (
              <>
                <div aria-label={`روند بازدیدهای ثبت‌شده در ${visitPeriods.find((item) => item.days === period)?.label}`} className="mt-4 h-64 min-w-0" dir="ltr" role="img">
                  <ResponsiveContainer height="100%" width="100%">
                    <LineChart data={points} margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
                      <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 3" />
                      <XAxis dataKey="businessDate" height={38} minTickGap={24} tick={{ fill: "var(--muted-foreground)", fontSize: 11 }} tickFormatter={formatTrendDate} tickLine={false} tickMargin={10} />
                      <YAxis allowDecimals={false} axisLine={false} tick={{ fill: "var(--muted-foreground)", fontSize: 11 }} tickFormatter={formatCount} tickLine={false} width={42} />
                      <Tooltip
                        cursor={{ stroke: "var(--border)" }}
                        formatter={(value) => [formatCount(Number(value)), "بازدیدهای ثبت‌شده"]}
                        labelFormatter={(label) => formatBookingDate(String(label))}
                      />
                      <Line activeDot={{ fill: "var(--primary)", r: 4 }} dataKey="recordedVisits" dot={period === 7} isAnimationActive={false} stroke="var(--primary)" strokeWidth={2} type="linear" />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
                <table className="sr-only">
                  <caption>بازدیدهای ثبت‌شده به تفکیک روز در بازه انتخاب‌شده</caption>
                  <thead><tr><th scope="col">تاریخ</th><th scope="col">تعداد</th></tr></thead>
                  <tbody>
                    {points.map((point) => (
                      <tr key={point.businessDate}>
                        <th scope="row">{formatBookingDate(point.businessDate)}</th>
                        <td>{formatCount(point.recordedVisits)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
            {!hasRecordedVisits && points.length > 0 && (
              <p className="mt-3 text-sm text-muted-foreground" role="status">در این بازه بازدیدی ثبت نشده است.</p>
            )}
            <p className="mt-3 text-xs leading-6 text-muted-foreground">
              تاریخ شروع ثبت بازدیدها مشخص نیست؛ صفرهای روزهای گذشته لزوماً به معنی فعال بودن ثبت بازدید در آن روزها نیست.
            </p>
          </KoochCard>
        </>
      ) : null}
    </section>
  );
}

function OwnerOperationalSummarySection({ propertyId }: { propertyId: number }) {
  const [state, setState] = useState<SummaryState | null>(null);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    if (!Number.isInteger(propertyId) || propertyId <= 0) return;
    const controller = new AbortController();
    setState({ propertyId, status: "loading" });
    apiRequest<OwnerOperationalSummary>(
      `/owner/properties/${propertyId}/reservations/operational-summary`,
      { signal: controller.signal },
    )
      .then((data) => {
        if (!controller.signal.aborted) setState({ propertyId, status: "ready", data });
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return;
        setState({
          propertyId,
          status: reason instanceof ApiRequestError && reason.status === 403
            ? "forbidden"
            : "error",
        });
      });
    return () => controller.abort();
  }, [propertyId, retry]);

  const current = state?.propertyId === propertyId ? state : null;

  return (
    <section aria-labelledby="owner-operational-summary-title" className="grid gap-3" dir="rtl">
      <div>
        <h2 id="owner-operational-summary-title" className="text-lg font-semibold text-foreground">
          وضعیت رزروهای اقامتگاه
        </h2>
        {current?.status === "ready" && (
          <p className="mt-1 text-sm text-muted-foreground">
            بر پایه تاریخ امروز اقامتگاه: <time dateTime={current.data.businessDate}>{formatBookingDate(current.data.businessDate)}</time>
          </p>
        )}
      </div>
      {(!current || current.status === "loading") ? (
        <KoochCard role="status">در حال دریافت خلاصه رزروها...</KoochCard>
      ) : current.status === "forbidden" ? (
        <KoochAlert title="دسترسی به خلاصه رزروها ندارید" variant="warning">
          برای مشاهده این اطلاعات به دسترسی رزروهای اقامتگاه نیاز دارید.
        </KoochAlert>
      ) : current.status === "error" ? (
        <KoochAlert title="دریافت خلاصه رزروها انجام نشد" variant="destructive">
          <p>اطلاعات سایر بخش‌های داشبورد همچنان در دسترس است.</p>
          <KoochButton className="mt-3" onClick={() => setRetry((value) => value + 1)} variant="outline">
            تلاش دوباره
          </KoochButton>
        </KoochAlert>
      ) : current.status === "ready" ? (
        <div className="grid gap-3 sm:grid-cols-3">
          {[
            { label: "در انتظار تأیید", value: current.data.pendingApprovalCount },
            { label: "ورود برنامه‌ریزی‌شده امروز", value: current.data.scheduledArrivalsTodayCount },
            { label: "خروج برنامه‌ریزی‌شده امروز", value: current.data.scheduledDeparturesTodayCount },
          ].map(({ label, value }) => (
            <KoochCard className="min-w-0" key={label} padding="sm">
              <p className="text-sm text-muted-foreground">{label}</p>
              <p className="mt-2 text-2xl font-semibold tabular-nums text-foreground">{formatCount(value)}</p>
            </KoochCard>
          ))}
        </div>
      ) : null}
    </section>
  );
}
