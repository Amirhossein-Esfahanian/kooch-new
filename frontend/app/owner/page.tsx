"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { OwnerLayout } from "@/components/dashboard/DashboardLayouts";
import { KoochAlert } from "@/components/KoochAlert";
import { KoochButton } from "@/components/KoochButton";
import { KoochCard } from "@/components/KoochCard";
import { KoochPageHeader } from "@/components/KoochPageHeader";
import { useOwnerProperty } from "@/components/owner/OwnerPropertyProvider";
import { apiRequest, ApiRequestError, type PropertyResponse } from "@/lib/owner-api";
import { canViewOwnerMenuItem } from "@/lib/property-menu-permissions";

const statusLabels: Record<string, string> = {
  Draft: "پیش‌نویس",
  PendingReview: "در انتظار بررسی",
  Approved: "تأیید شده",
  Rejected: "رد شده",
  Suspended: "تعلیق شده",
};

export default function OwnerHomePage() {
  return (
    <OwnerLayout allowEmptyMemberships>
      <OwnerDashboardEntry />
    </OwnerLayout>
  );
}

function OwnerDashboardEntry() {
  const { activeMemberships } = useOwnerProperty();
  const [properties, setProperties] = useState<PropertyResponse[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [permissionDenied, setPermissionDenied] = useState(false);
  const [retry, setRetry] = useState(0);
  const membershipIds = activeMemberships.map((item) => item.propertyId).join(",");

  useEffect(() => {
    if (!membershipIds) {
      setProperties([]);
      setLoading(false);
      setError(false);
      return;
    }

    const controller = new AbortController();
    setLoading(true);
    setError(false);
    setPermissionDenied(false);
    setProperties(null);
    apiRequest<PropertyResponse[]>("/owner/properties", { signal: controller.signal })
      .then((result) => {
        if (!controller.signal.aborted) setProperties(result);
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return;
        setProperties(null);
        setPermissionDenied(reason instanceof ApiRequestError && reason.status === 403);
        setError(true);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [membershipIds, retry]);

  const membershipsById = new Map(activeMemberships.map((item) => [item.propertyId, item]));
  const accessibleProperties = properties?.filter((property) => membershipsById.has(property.id)) ?? [];

  return (
    <main className="mx-auto grid max-w-[1480px] gap-5 p-4 lg:p-6" dir="rtl">
      <KoochPageHeader
        appearance="plain"
        eyebrow={null}
        title="داشبورد مالک"
        description="اقامتگاه‌های در دسترس شما و مسیرهای مدیریت هر کدام"
      />

      {loading ? (
        <KoochCard role="status">در حال دریافت اقامتگاه‌ها...</KoochCard>
      ) : error ? (
        <KoochAlert
          title={permissionDenied ? "دسترسی به اقامتگاه‌ها ندارید" : "دریافت اقامتگاه‌ها انجام نشد"}
          variant={permissionDenied ? "warning" : "destructive"}
        >
          <p>{permissionDenied ? "دسترسی مشاهده اقامتگاه‌ها برای حساب شما تأیید نشد." : "لطفاً دوباره تلاش کنید."}</p>
          {!permissionDenied && (
            <KoochButton className="mt-3" onClick={() => setRetry((value) => value + 1)} variant="outline">
              تلاش دوباره
            </KoochButton>
          )}
        </KoochAlert>
      ) : accessibleProperties.length === 0 ? (
        <KoochCard role="status">
          {activeMemberships.length === 0
            ? "در حال حاضر به هیچ اقامتگاهی دسترسی فعال ندارید."
            : "اقامتگاهی برای نمایش در دسترس نیست."}
        </KoochCard>
      ) : (
        <section aria-label="اقامتگاه‌های من" className="grid gap-4 md:grid-cols-2">
          {accessibleProperties.map((property) => {
            const membership = membershipsById.get(property.id)!;
            const base = `/owner/properties/${property.id}`;
            return (
              <KoochCard className="min-w-0" key={property.id}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="break-words text-lg font-semibold text-foreground">{property.name}</h2>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {[property.destinationName || property.city, property.country].filter(Boolean).join(" · ")}
                    </p>
                  </div>
                  <span className="rounded-lg bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">
                    {statusLabels[property.status] ?? property.status}
                  </span>
                </div>
                <nav aria-label={`مدیریت ${property.name}`} className="mt-5 flex flex-wrap gap-x-5 gap-y-3 border-t border-border pt-4 text-sm font-semibold">
                  <Link className="text-primary underline-offset-4 hover:underline focus-visible:underline" href={`${base}/dashboard`}>
                    داشبورد اقامتگاه
                  </Link>
                  {canViewOwnerMenuItem(membership.effectivePermissions, "Bookings") && (
                    <Link className="text-primary underline-offset-4 hover:underline focus-visible:underline" href={`${base}/reservations`}>
                      رزروها
                    </Link>
                  )}
                  {canViewOwnerMenuItem(membership.effectivePermissions, "Pricing") && (
                    <Link className="text-primary underline-offset-4 hover:underline focus-visible:underline" href={`${base}/pricing`}>
                      تقویم قیمت‌گذاری
                    </Link>
                  )}
                </nav>
              </KoochCard>
            );
          })}
        </section>
      )}
    </main>
  );
}
