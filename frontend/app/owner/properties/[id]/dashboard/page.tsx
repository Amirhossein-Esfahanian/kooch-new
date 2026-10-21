"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
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

const formatCount = (value: number) => new Intl.NumberFormat("fa-IR").format(value);

const linkButtonClass =
  "inline-flex min-h-10 items-center justify-center rounded-md border px-4 py-2 text-sm font-semibold transition focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-background";

export default function OwnerPropertyDashboardPage() {
  const params = useParams<{ id: string }>();
  const propertyId = Number(params.id);
  const { authenticated, loading, workspaces } = useAuthSession();
  const { effectivePermissions, routePropertyIsValid } = useOwnerProperty();
  const canViewBookings = routePropertyIsValid &&
    canViewOwnerMenuItem(effectivePermissions, "Bookings");
  const [property, setProperty] = useState<PropertyResponse | null>(null);
  const [completion, setCompletion] =
    useState<PropertyCompletionResponse | null>(null);
  const [roomTypes, setRoomTypes] = useState<RoomTypeResponse[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    if (loading || !authenticated || !workspaces.includes("owner")) return;

    Promise.all([
      apiRequest<PropertyResponse>(`/owner/properties/${propertyId}`),
      apiRequest<PropertyCompletionResponse>(
        `/owner/properties/${propertyId}/completion`,
      ),
      apiRequest<RoomTypeResponse[]>(
        `/owner/properties/${propertyId}/room-types`,
      ),
    ])
      .then(([propertyResult, completionResult, roomTypesResult]) => {
        setProperty(propertyResult);
        setCompletion(completionResult);
        setRoomTypes(roomTypesResult);
      })
      .catch((caught: Error) => setError(caught.message));
  }, [authenticated, loading, propertyId, workspaces]);

  const cards = [
    {
      title: "تکمیل اطلاعات",
      value: `${completion?.completionPercentage ?? 0}٪`,
      href: `/owner/properties/${propertyId}`,
    },
    {
      title: "نوع اتاق",
      value: roomTypes.length.toString(),
      href: `/owner/properties/${propertyId}/rooms`,
    },
    {
      title: "وضعیت",
      value: property?.status ?? "-",
      href: `/owner/properties/${propertyId}/settings`,
    },
    {
      title: "شهر",
      value: property?.city ?? "-",
      href: `/owner/properties/${propertyId}/settings`,
    },
  ];

  return (
    <OwnerLayout>
      <main className="mx-auto grid max-w-[1480px] gap-5 p-4 lg:p-6">
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
          description={property?.name ?? "در حال بارگذاری..."}
          eyebrow="اقامتگاه فعال"
          title="داشبورد"
        />

        {error && (
          <KoochCard
            className="border-destructive/30 bg-destructive/10 text-destructive"
            padding="sm"
          >
            <p className="text-sm font-semibold">{error}</p>
          </KoochCard>
        )}

        <PricingSettingsWarning
          editHref={`/owner/properties/${propertyId}?step=7`}
          warnings={getPropertyFinancialWarnings(property, roomTypes)}
        />

        {completion && (
          <PropertyCompletionCard
            completion={completion}
            getActionHref={(section) =>
              propertyCompletionHref("owner", propertyId, section)
            }
          />
        )}

        {canViewBookings && authenticated && !loading && workspaces.includes("owner") && (
          <OwnerOperationalSummarySection propertyId={propertyId} />
        )}

        <div className="grid gap-4 md:grid-cols-4">
          {cards.map((card) => (
            <Link href={card.href} key={card.title}>
              <KoochCard
                className="h-full transition hover:border-primary"
                variant="elevated"
              >
                <p className="text-sm font-bold text-muted-foreground">
                  {card.title}
                </p>
                <p className="mt-3 text-2xl font-bold text-foreground">
                  {card.value}
                </p>
              </KoochCard>
            </Link>
          ))}
        </div>

        <KoochCard className="mt-5" variant="elevated">
          <h2 className="text-xl font-bold text-foreground">کارهای سریع</h2>
          <div className="mt-4 flex flex-wrap gap-3">
            <Link
              className={`${linkButtonClass} border-primary bg-primary text-primary-foreground hover:bg-[var(--primary-hover)]`}
              href={`/owner/properties/${propertyId}/inventory`}
            >
              مدیریت ظرفیت
            </Link>
            <Link
              className={`${linkButtonClass} border-border bg-background text-foreground hover:bg-muted`}
              href={`/owner/properties/${propertyId}/rooms`}
            >
              اتاق‌ها
            </Link>
            <Link
              className={`${linkButtonClass} border-border bg-background text-foreground hover:bg-muted`}
              href={`/owner/properties/${propertyId}`}
            >
              ویرایش کامل اقامتگاه
            </Link>
          </div>
        </KoochCard>
      </main>
    </OwnerLayout>
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
