"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import timezone from "dayjs/plugin/timezone";
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
import { KoochIcon, type KoochIconName } from "@/components/KoochIcon";
import { KoochPageHeader } from "@/components/KoochPageHeader";
import { useOwnerProperty } from "@/components/owner/OwnerPropertyProvider";
import { OwnerPublicBookingLinkCard } from "@/components/owner/OwnerPublicBookingLinkCard";
import { formatBookingDate } from "@/components/booking/booking-display";
import {
  apiRequest,
  ApiRequestError,
  PropertyCompletionResponse,
  PropertyCompletionSectionResponse,
  PropertyResponse,
  RoomTypeResponse,
  type PermissionGroup,
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

interface OwnerDailyInventorySummary {
  propertyId: number;
  businessDate: string;
  configuredUnits: number;
  eligibleConfiguredUnits: number;
  reservedAllocatedUnits: number;
  remainingUnits: number;
  availableModeRemainingUnits: number;
  onRequestRemainingUnits: number;
  blockedRoomTypeCount: number;
}

type InventorySummaryState =
  | { propertyId: number; status: "loading" }
  | { propertyId: number; status: "ready"; data: OwnerDailyInventorySummary }
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

type CreatedCountState =
  | { propertyId: number; businessDate: string; status: "loading" }
  | { propertyId: number; businessDate: string; status: "ready"; count: number }
  | { propertyId: number; businessDate: string; status: "error" | "forbidden" };

dayjs.extend(utc);
dayjs.extend(timezone);

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

function createdReservationsTodayPath(propertyId: number, businessDate: string) {
  const nextDay = dayjs.utc(businessDate).add(1, "day").format("YYYY-MM-DD");
  const fromUtc = dayjs.tz(businessDate, "Asia/Tehran").utc().toISOString();
  const nextDayStartUtc = dayjs.tz(nextDay, "Asia/Tehran").utc();
  // ReservationListQuery.CreatedTo is inclusive, with SQL DateTime precision of seven fractional digits.
  const toUtcInclusive = nextDayStartUtc.subtract(1, "millisecond").toISOString().replace(/Z$/, "9999Z");
  const params = new URLSearchParams({ page: "1", pageSize: "1", createdFrom: fromUtc, createdTo: toUtcInclusive });
  return `/owner/properties/${propertyId}/reservations?${params}`;
}

function completionEditPermission(section: PropertyCompletionSectionResponse): PermissionGroup {
  if (section.key === "financial") return "Properties";
  switch (section.actionTarget || section.key) {
    case "rooms": return "Rooms";
    case "pricing": return "Pricing";
    case "availability": return "Inventory";
    default: return "Properties";
  }
}

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
  const reviewRequest = useRef<AbortController | null>(null);
  const [reviewState, setReviewState] = useState<{
    propertyId: number;
    status: "loading" | "success" | "error" | "forbidden";
    message: string;
    needsRefresh?: boolean;
  } | null>(null);
  const canEditProperty = routePropertyIsValid && Boolean(effectivePermissions?.Properties?.edit);

  useEffect(() => {
    setReviewState(null);
    return () => {
      reviewRequest.current?.abort();
      reviewRequest.current = null;
    };
  }, [propertyId, authenticated, routePropertyIsValid, canEditProperty]);

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

  const currentOverview = authenticated && !loading && isOwnerWorkspace && routePropertyIsValid &&
    overviewState?.propertyId === propertyId ? overviewState : null;
  const overview = currentOverview?.status === "ready" ? currentOverview : null;
  const property = overview?.property;
  const activeRoomTypeCount = canViewRooms && overview
    ? overview.roomTypes.filter((roomType) => roomType.isActive).length
    : null;
  const incompleteSections = overview?.completion.sections?.filter((section) =>
    section.status !== "Complete" && section.missingItems.length > 0) ?? [];
  const showCompletionChecklist = Boolean(
    overview && (property?.status === "Draft" || property?.status === "Rejected") && incompleteSections.length > 0,
  );
  const review = reviewState?.propertyId === propertyId ? reviewState : null;
  const canSubmit = authenticated && !loading && isOwnerWorkspace && canEditProperty &&
    (property?.status === "Draft" || property?.status === "Rejected") &&
    overview?.completion.canActivate === true;
  const firstEditableSection = incompleteSections.find((section) =>
    review?.status !== "forbidden" && effectivePermissions?.[completionEditPermission(section)]?.edit);
  const approvalBannerTone: { surface: string; border: string; iconColor: string; icon: KoochIconName } =
    property?.status === "Rejected"
      ? { surface: "var(--theme-danger-soft)", border: "color-mix(in srgb, var(--theme-danger) 22%, var(--border))", iconColor: "var(--theme-danger)", icon: "error" }
      : property?.status === "Suspended"
        ? { surface: "var(--muted)", border: "var(--border)", iconColor: "var(--muted-foreground)", icon: "suspend" }
        : property?.status === "Draft" && overview?.completion.canActivate !== true
          ? { surface: "var(--theme-warning-soft)", border: "color-mix(in srgb, var(--theme-warning) 22%, var(--border))", iconColor: "var(--theme-warning)", icon: "warning" }
          : { surface: "var(--theme-primary-soft)", border: "var(--theme-primary-border)", iconColor: "var(--theme-primary-text)", icon: "info" };

  async function submitForReview() {
    if (!canSubmit || reviewRequest.current || review?.status === "forbidden" || review?.needsRefresh) return;
    const controller = new AbortController();
    reviewRequest.current = controller;
    const { signal } = controller;
    setReviewState({ propertyId, status: "loading", message: "در حال ارسال برای بررسی..." });

    async function refreshApproval() {
      const [freshProperty, completion] = await Promise.all([
        apiRequest<PropertyResponse>(`/owner/properties/${propertyId}`, { signal }),
        apiRequest<PropertyCompletionResponse>(`/owner/properties/${propertyId}/completion`, { signal }),
      ]);
      if (!signal.aborted) setOverviewState((previous) => previous?.status === "ready" && previous.propertyId === propertyId
        ? { ...previous, property: freshProperty, completion } : previous);
    }

    let submissionCompleted = false;
    try {
      const submitted = await apiRequest<PropertyResponse>(`/owner/properties/${propertyId}/submit-for-review`, { method: "POST", signal });
      if (signal.aborted) return;
      submissionCompleted = true;
      // Use the server's status, never infer approval from completeness.
      setOverviewState((previous) => previous?.status === "ready" && previous.propertyId === propertyId
        ? { ...previous, property: submitted } : previous);
      await refreshApproval();
      if (!signal.aborted) setReviewState({ propertyId, status: "success", message: "درخواست بررسی ثبت شد. تأیید نهایی فقط توسط مدیر انجام می‌شود." });
    } catch (reason: unknown) {
      if (signal.aborted) return;
      if (reason instanceof ApiRequestError && reason.status === 403) {
        setReviewState({ propertyId, status: "forbidden", message: "اجازه ارسال این اقامتگاه برای بررسی را ندارید." });
        return;
      }
      const body = reason instanceof ApiRequestError ? reason.body as { completion?: PropertyCompletionResponse } | null : null;
      const completion = body?.completion;
      if (completion?.propertyId === propertyId && Array.isArray(completion.sections) && typeof completion.canActivate === "boolean") {
        setOverviewState((previous) => previous?.status === "ready" && previous.propertyId === propertyId
          ? { ...previous, completion } : previous);
      }
      let needsRefresh = submissionCompleted;
      if (!submissionCompleted) {
        try { await refreshApproval(); } catch { needsRefresh = true; }
      }
      if (!signal.aborted) setReviewState({
        propertyId, status: "error", needsRefresh,
        message: reason instanceof ApiRequestError && reason.status === 409
          ? reason.message
          : "ارسال یا به‌روزرسانی وضعیت انجام نشد. پیش از تلاش دوباره، وضعیت اقامتگاه را بررسی کنید.",
      });
    } finally {
      if (reviewRequest.current === controller) reviewRequest.current = null;
    }
  }
  const quickActions = [
    { label: "قیمت‌گذاری", description: "مدیریت قیمت اتاق‌ها", icon: "price" as const, permission: "Pricing" as const, href: `/owner/properties/${propertyId}/pricing` },
    { label: "ظرفیت و موجودی", description: "تقویم ظرفیت و دسترسی", icon: "capacity" as const, permission: "Inventory" as const, href: `/owner/properties/${propertyId}/inventory` },
    { label: "رزروها", description: "بررسی و پیگیری رزروها", icon: "audit" as const, permission: "Bookings" as const, href: `/owner/properties/${propertyId}/reservations` },
    { label: "اتاق‌ها", description: "مدیریت نوع اتاق‌ها", icon: "home" as const, permission: "Rooms" as const, href: `/owner/properties/${propertyId}/rooms` },
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

        {overview && property?.status !== "Approved" && (
          <section aria-label="بررسی و تأیید اقامتگاه" className="min-w-0">
            <KoochCard
              className="grid gap-4 p-5 sm:p-6"
              padding="none"
              style={{ backgroundColor: approvalBannerTone.surface, borderColor: approvalBannerTone.border }}
            >
              <div className="grid gap-1">
                <h2 className="flex items-center gap-2 text-lg font-bold text-foreground sm:text-xl">
                  <KoochIcon className="size-5" name={approvalBannerTone.icon} style={{ color: approvalBannerTone.iconColor }} />
                  {property?.status === "PendingReview" ? "اقامتگاه در انتظار بررسی مدیر است"
                    : property?.status === "Suspended" ? "اقامتگاه تعلیق شده است"
                      : overview.completion.canActivate === true ? "اقامتگاه آماده بررسی مدیر است"
                        : "اطلاعات لازم برای تأیید اقامتگاه کامل نیست"}
                </h2>
                <p className="text-sm leading-6 text-foreground/85">
                  {property?.status === "PendingReview" ? "درخواست بررسی ثبت شده است. پس از بررسی مدیر، نتیجه مشخص می‌شود."
                    : property?.status === "Suspended" ? "ارسال مجدد برای بررسی در این وضعیت امکان‌پذیر نیست."
                      : overview.completion.canActivate === true ? "اطلاعات لازم تکمیل است؛ تأیید نهایی نیازمند بررسی مدیر است."
                        : "برای ارسال اقامتگاه به مدیر، موارد ضروری زیر را تکمیل کنید."}
                </p>
              </div>

              {showCompletionChecklist && (
                <section aria-label="تکمیل و راه‌اندازی اقامتگاه" className="grid gap-2">
                  <h3 className="text-sm font-semibold text-foreground">موارد باقی‌مانده</h3>
                  <ul className="grid gap-2 sm:grid-cols-2">
                    {incompleteSections.flatMap((section) => section.missingItems.map((item) => {
                      const canEdit = review?.status !== "forbidden" && Boolean(effectivePermissions?.[completionEditPermission(section)]?.edit);
                      const href = propertyCompletionHref("owner", propertyId, section);
                      return (
                        <li className="min-w-0 rounded-lg border border-border bg-background/80 px-3 py-2 text-sm" key={`${section.key}-${item}`}>
                          <span className="text-muted-foreground">{section.label}: </span>
                          {canEdit ? (
                            <Link className="font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring" href={href}>
                              {item}
                            </Link>
                          ) : <span className="font-medium text-foreground">{item}</span>}
                        </li>
                      );
                    }))}
                  </ul>
                </section>
              )}

              {review && (
                <div className="text-sm font-medium text-foreground" role={review.status === "loading" || review.status === "success" ? "status" : "alert"}>
                  <p>{review.message}</p>
                  {review.needsRefresh && (
                    <KoochButton className="mt-3" variant="outline" onClick={() => { setReviewState(null); setOverviewRetry((value) => value + 1); }}>
                      به‌روزرسانی وضعیت اقامتگاه
                    </KoochButton>
                  )}
                </div>
              )}

              {(canSubmit && review?.status !== "forbidden" && !review?.needsRefresh ||
                showCompletionChecklist && firstEditableSection) && (
                <div className="flex flex-wrap gap-3">
                  {canSubmit && review?.status !== "forbidden" && !review?.needsRefresh && (
                    <KoochButton loading={review?.status === "loading"} onClick={submitForReview} size="lg">
                      {property?.status === "Rejected" ? "ارسال مجدد برای بررسی" : "ارسال برای بررسی مدیر"}
                    </KoochButton>
                  )}
                  {showCompletionChecklist && firstEditableSection && (
                    <Link className={`${linkButtonClass} border-primary bg-primary text-primary-foreground hover:bg-[var(--primary-hover)]`} href={propertyCompletionHref("owner", propertyId, firstEditableSection)}>
                      تکمیل اطلاعات ضروری
                    </Link>
                  )}
                </div>
              )}
            </KoochCard>
          </section>
        )}

        {(canViewBookings || canViewRooms) && authenticated && !loading && isOwnerWorkspace && (
          <OwnerOperationalSummarySection
            activeRoomTypeCount={activeRoomTypeCount}
            canViewBookings={canViewBookings}
            propertyId={propertyId}
          />
        )}

        {quickActions.length > 0 && (
          <section aria-labelledby="owner-quick-actions-title" className="grid gap-3">
            <h2 id="owner-quick-actions-title" className="text-sm font-semibold text-foreground">کارهای سریع</h2>
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
              {quickActions.map((action) => (
                <Link className="group flex min-h-14 min-w-0 items-center gap-3 rounded-lg px-3 py-2 text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background" href={action.href} key={action.label}>
                  <KoochIcon className="text-muted-foreground group-hover:text-foreground" name={action.icon} />
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold group-hover:underline group-hover:underline-offset-4">{action.label}</span>{" "}
                    <span className="block text-xs leading-5 text-muted-foreground">{action.description}</span>
                  </span>
                </Link>
              ))}
            </div>
          </section>
        )}

        {authenticated && !loading && isOwnerWorkspace && (
          <OwnerPublicBookingLinkCard
            key={propertyId}
            canViewProperty={routePropertyIsValid && canViewOwnerMenuItem(effectivePermissions, "Properties")}
            loading={!currentOverview || currentOverview.status === "loading"}
            property={property?.id === propertyId ? property : undefined}
          />
        )}

        {canViewReports && authenticated && !loading && isOwnerWorkspace && (
          <>
            <OwnerDailyInventorySummarySection propertyId={propertyId} />
            <OwnerPropertyVisitAnalyticsSection canViewBookings={canViewBookings} propertyId={propertyId} />
          </>
        )}
      </main>
    </OwnerLayout>
  );
}

function OwnerDailyInventorySummarySection({ propertyId }: { propertyId: number }) {
  const [state, setState] = useState<InventorySummaryState | null>(null);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    if (!Number.isInteger(propertyId) || propertyId <= 0) return;
    const controller = new AbortController();
    setState({ propertyId, status: "loading" });
    apiRequest<OwnerDailyInventorySummary>(`/owner/properties/${propertyId}/inventory/today-summary`, {
      signal: controller.signal,
    })
      .then((data) => {
        if (controller.signal.aborted) return;
        const values = [data?.configuredUnits, data?.reservedAllocatedUnits,
          data?.availableModeRemainingUnits, data?.onRequestRemainingUnits];
        if (data?.propertyId !== propertyId || typeof data.businessDate !== "string" ||
          !/^\d{4}-\d{2}-\d{2}$/.test(data.businessDate) ||
          !Number.isFinite(parseLocalIsoDate(data.businessDate).getTime()) ||
          !values.every((value) => Number.isSafeInteger(value) && value >= 0)) {
          setState({ propertyId, status: "error" });
          return;
        }
        setState({ propertyId, status: "ready", data });
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return;
        setState({ propertyId, status: reason instanceof ApiRequestError && (reason.status === 403 || reason.status === 404)
          ? "forbidden" : "error" });
      });
    return () => controller.abort();
  }, [propertyId, retry]);

  const current = state?.propertyId === propertyId ? state : null;
  const data = current?.status === "ready" ? current.data : null;
  const metrics = data ? [
    { label: "ظرفیت تعریف‌شده", value: data.configuredUnits },
    { label: "تخصیص‌یافته به رزروها", value: data.reservedAllocatedUnits },
    { label: "باقی‌مانده عادی", value: data.availableModeRemainingUnits },
    { label: "باقی‌مانده درخواستی", value: data.onRequestRemainingUnits },
  ] : [];

  return (
    <KoochCard aria-labelledby="owner-inventory-summary-title" className="grid min-w-0 gap-5 sm:p-6" dir="rtl">
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2">
        <div className="min-w-0">
          <h2 id="owner-inventory-summary-title" className="text-lg font-semibold text-foreground">وضعیت موجودی امروز</h2>
          <p className="mt-1 text-xs leading-6 text-muted-foreground">
            اعداد بر پایه واحد رزروِ انواع اتاق فعال هستند، نه تعداد اتاق فیزیکی؛ باقی‌مانده عادی تضمین فروش یا رزرو فوری نیست.
          </p>
        </div>
        {data && <p className="text-xs leading-6 text-muted-foreground">تاریخ تهران: <time dateTime={data.businessDate}>{formatBookingDate(data.businessDate)}</time></p>}
      </div>
      {!current || current.status === "loading" ? (
        <div aria-label="در حال دریافت موجودی امروز" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" role="status">
          {Array.from({ length: 4 }, (_, index) => (
            <div aria-hidden="true" className="min-h-32 rounded-lg bg-muted p-4" key={index}>
              <div className="h-4 w-2/3 rounded bg-background motion-safe:animate-pulse" />
              <div className="mt-3 h-7 w-1/3 rounded bg-background motion-safe:animate-pulse" />
            </div>
          ))}
        </div>
      ) : current.status === "forbidden" ? (
        <KoochAlert title="دسترسی به موجودی امروز این اقامتگاه ندارید" variant="warning">
          این بخش به دسترسی گزارش‌های همین اقامتگاه نیاز دارد یا اقامتگاه دیگر در دسترس نیست.
        </KoochAlert>
      ) : current.status === "error" ? (
        <KoochAlert title="دریافت موجودی امروز انجام نشد" variant="destructive">
          <p>سایر بخش‌های داشبورد همچنان در دسترس هستند.</p>
          <KoochButton className="mt-3" onClick={() => setRetry((value) => value + 1)} variant="outline">تلاش دوباره</KoochButton>
        </KoochAlert>
      ) : data ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {metrics.map(({ label, value }) => (
              <div aria-label={label} className="flex min-h-32 min-w-0 flex-col items-center justify-center gap-3 rounded-lg bg-muted p-4 text-center" key={label} role="region">
                <p className="text-sm leading-6 text-muted-foreground">{label}</p>
                <p className="flex flex-wrap items-baseline justify-center gap-2 text-foreground">
                  <span className="break-words text-3xl font-semibold tabular-nums">{formatCount(value)}</span>
                  <span className="text-xs text-muted-foreground">واحد رزرو</span>
                </p>
              </div>
            ))}
          </div>
          {data.configuredUnits === 0 && data.reservedAllocatedUnits === 0 && (
            <p className="text-sm text-muted-foreground" role="status">برای امروز ظرفیت یا تخصیص رزروی ثبت نشده است.</p>
          )}
        </>
      ) : null}
    </KoochCard>
  );
}

function OwnerPropertyVisitAnalyticsSection({ canViewBookings, propertyId }: { canViewBookings: boolean; propertyId: number }) {
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
    <KoochCard aria-labelledby="owner-visit-analytics-title" className="grid min-w-0 gap-6 sm:p-6" dir="rtl">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="owner-visit-analytics-title" className="text-lg font-semibold text-foreground">
            بازدیدهای ثبت‌شده
          </h2>
          {data && (
            <p className="mt-1 text-xs leading-6 text-muted-foreground">
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
        <div aria-label="در حال دریافت آمار بازدیدها" role="status">
          <div aria-hidden="true" className="grid gap-3 motion-safe:animate-pulse sm:grid-cols-2">
            <div className="h-16 rounded-lg bg-muted" />
            <div className="h-16 rounded-lg bg-muted" />
            <div className="h-56 rounded-lg bg-muted sm:col-span-2" />
          </div>
        </div>
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
        <div className="grid min-w-0 gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <div className="min-w-0">
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
                        contentStyle={{ backgroundColor: "var(--popover)", borderColor: "var(--border)", borderRadius: "0.5rem", color: "var(--popover-foreground)", direction: "rtl", textAlign: "right" }}
                        cursor={{ stroke: "var(--border)" }}
                        formatter={(value) => [formatCount(Number(value)), "بازدیدهای ثبت‌شده"]}
                        labelStyle={{ color: "var(--popover-foreground)" }}
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
          </div>
          <div className={`grid gap-3 ${canViewBookings ? "grid-rows-3" : "grid-rows-2"}`}>
            <section aria-label="بازدیدهای ثبت‌شده امروز" className="flex min-h-28 min-w-0 flex-col justify-center gap-2 rounded-lg bg-muted p-4">
              <p className="text-sm leading-6 text-muted-foreground">بازدیدهای ثبت‌شده امروز</p>
              <p className="break-words text-3xl font-semibold tabular-nums text-foreground">{formatCount(data.todayRecordedVisits)}</p>
            </section>
            <section aria-label="بازدیدهای ثبت‌شده در بازه انتخاب‌شده" className="flex min-h-28 min-w-0 flex-col justify-center gap-2 rounded-lg bg-muted p-4">
              <p className="text-sm leading-6 text-muted-foreground">بازدیدهای ثبت‌شده در {visitPeriods.find((item) => item.days === period)?.label}</p>
              <p className="break-words text-3xl font-semibold tabular-nums text-foreground">
                {formatCount(period === 7 ? data.last7DaysTotal : period === 30 ? data.last30DaysTotal : data.last90DaysTotal)}
              </p>
            </section>
            {canViewBookings && <CreatedReservationsTodayCard businessDate={data.businessDate} propertyId={propertyId} />}
          </div>
        </div>
      ) : null}
    </KoochCard>
  );
}

function CreatedReservationsTodayCard({ businessDate, propertyId }: { businessDate: string; propertyId: number }) {
  const [state, setState] = useState<CreatedCountState | null>(null);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setState({ propertyId, businessDate, status: "loading" });
    apiRequest<{ totalCount: number }>(createdReservationsTodayPath(propertyId, businessDate), { signal: controller.signal })
      .then((page) => {
        if (controller.signal.aborted) return;
        setState(Number.isInteger(page?.totalCount) && page.totalCount >= 0
          ? { propertyId, businessDate, status: "ready", count: page.totalCount }
          : { propertyId, businessDate, status: "error" });
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return;
        setState({ propertyId, businessDate, status: reason instanceof ApiRequestError && (reason.status === 403 || reason.status === 404)
          ? "forbidden" : "error" });
      });
    return () => controller.abort();
  }, [businessDate, propertyId, retry]);

  const current = state?.propertyId === propertyId && state.businessDate === businessDate ? state : null;
  return (
    <section aria-label="رزروهای امروز" className="flex min-h-28 min-w-0 flex-col justify-center gap-2 rounded-lg bg-muted p-4">
      <p className="text-sm leading-6 text-muted-foreground">رزروهای امروز</p>
      {!current || current.status === "loading" ? (
        <p className="mt-2 text-sm text-muted-foreground" role="status">در حال دریافت...</p>
      ) : current.status === "ready" ? (
        <p className="break-words text-3xl font-semibold tabular-nums text-foreground">{formatCount(current.count)}</p>
      ) : current.status === "forbidden" ? (
        <p className="mt-2 text-xs text-muted-foreground">دسترسی به شمار رزروها ندارید.</p>
      ) : (
        <div>
          <p className="mt-2 text-xs text-muted-foreground">دریافت شمار رزروها انجام نشد.</p>
          <KoochButton className="mt-1" onClick={() => setRetry((value) => value + 1)} size="sm" variant="ghost">تلاش دوباره</KoochButton>
        </div>
      )}
    </section>
  );
}

function OwnerOperationalSummarySection({
  activeRoomTypeCount,
  canViewBookings,
  propertyId,
}: {
  activeRoomTypeCount: number | null;
  canViewBookings: boolean;
  propertyId: number;
}) {
  const [state, setState] = useState<SummaryState | null>(null);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    if (!canViewBookings || !Number.isInteger(propertyId) || propertyId <= 0) return;
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
  }, [canViewBookings, propertyId, retry]);

  const current = state?.propertyId === propertyId ? state : null;
  const summary = canViewBookings && current?.status === "ready" ? current.data : null;
  const metrics = [
    ...(summary ? [
      { label: "در انتظار تأیید", value: summary.pendingApprovalCount },
      { label: "ورودهای امروز", value: summary.scheduledArrivalsTodayCount },
      { label: "خروج‌های امروز", value: summary.scheduledDeparturesTodayCount },
    ] : []),
    ...(activeRoomTypeCount === null ? [] : [{ label: "انواع اتاق فعال", value: activeRoomTypeCount }]),
  ];

  return (
    <section aria-labelledby="owner-operational-summary-title" className="grid gap-3" dir="rtl">
      <div>
        <h2 id="owner-operational-summary-title" className="text-lg font-semibold text-foreground">
          وضعیت رزروهای اقامتگاه
        </h2>
        {summary && (
          <p className="mt-1 text-sm text-muted-foreground">
            ورود و خروج بر اساس برنامه رزروها، در تاریخ تهران: <time dateTime={summary.businessDate}>{formatBookingDate(summary.businessDate)}</time>
          </p>
        )}
      </div>
      {canViewBookings && (!current || current.status === "loading") && (
        <KoochCard role="status">در حال دریافت خلاصه رزروها...</KoochCard>
      )}
      {canViewBookings && current?.status === "forbidden" && (
        <KoochAlert title="دسترسی به خلاصه رزروها ندارید" variant="warning">
          برای مشاهده این اطلاعات به دسترسی رزروهای اقامتگاه نیاز دارید.
        </KoochAlert>
      )}
      {canViewBookings && current?.status === "error" && (
        <KoochAlert title="دریافت خلاصه رزروها انجام نشد" variant="destructive">
          <p>اطلاعات سایر بخش‌های داشبورد همچنان در دسترس است.</p>
          <KoochButton className="mt-3" onClick={() => setRetry((value) => value + 1)} variant="outline">
            تلاش دوباره
          </KoochButton>
        </KoochAlert>
      )}
      {metrics.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {metrics.map(({ label, value }) => (
            <KoochCard className="flex min-h-40 min-w-0 flex-col items-center justify-center gap-4 text-center" key={label}>
              <p className="text-sm font-medium leading-6 text-muted-foreground">{label}</p>
              <p className="max-w-full break-words text-4xl font-bold leading-tight tabular-nums text-foreground xl:text-5xl">{formatCount(value)}</p>
            </KoochCard>
          ))}
        </div>
      )}
    </section>
  );
}
