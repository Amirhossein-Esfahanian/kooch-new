"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useAuthSession } from "@/components/auth/AuthSessionProvider";
import { AdminLayout } from "@/components/dashboard/DashboardLayouts";
import { KoochAlert } from "@/components/KoochAlert";
import { KoochButton } from "@/components/KoochButton";
import { KoochCard } from "@/components/KoochCard";
import { KoochPageHeader } from "@/components/KoochPageHeader";
import { apiRequest, ApiRequestError, type AdminDashboardResponse } from "@/lib/owner-api";

const number = (value: number) => new Intl.NumberFormat("fa-IR").format(value);

export default function AdminDashboardPage() {
  const { platformPermissions, platformRole } = useAuthSession();
  const canViewDashboard = platformRole === "SuperAdmin" || platformPermissions.includes("ViewDashboard");

  return (
    <AdminLayout requiredPlatformPermission={canViewDashboard ? "ViewDashboard" : undefined}>
      {canViewDashboard ? <AdminDashboardContent /> : (
        <main className="mx-auto max-w-[1480px] p-4 lg:p-6" dir="rtl">
          <KoochAlert title="دسترسی به داشبورد ندارید" variant="warning">
            برای مشاهده داشبورد به دسترسی «مشاهده داشبورد» نیاز دارید.
          </KoochAlert>
        </main>
      )}
    </AdminLayout>
  );
}

function AdminDashboardContent() {
  const { platformPermissions, platformRole } = useAuthSession();
  const canManageProperties = platformRole === "SuperAdmin" || platformPermissions.includes("ManageProperties");
  const canManageUsers = platformRole === "SuperAdmin" || platformPermissions.includes("ManageUsers");
  const [dashboard, setDashboard] = useState<AdminDashboardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [permissionDenied, setPermissionDenied] = useState(false);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    setPermissionDenied(false);
    setDashboard(null);
    apiRequest<AdminDashboardResponse>("/admin/dashboard", { signal: controller.signal })
      .then((result) => setDashboard(result))
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return;
        setDashboard(null);
        setPermissionDenied(reason instanceof ApiRequestError && reason.status === 403);
        setError("دریافت اطلاعات داشبورد انجام نشد.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [retry]);

  const counts = dashboard ? [
    { label: "کل اقامتگاه‌ها", value: dashboard.totalProperties, href: canManageProperties ? "/admin/properties" : null },
    { label: "در انتظار بررسی", value: dashboard.pendingProperties, href: canManageProperties ? "/admin/properties" : null },
    { label: "اقامتگاه‌های تأییدشده", value: dashboard.approvedProperties, href: canManageProperties ? "/admin/properties" : null },
    { label: "کل کاربران", value: dashboard.totalUsers, href: canManageUsers ? "/admin/users" : null },
    { label: "مالکان فعال", value: dashboard.totalOwners, href: canManageUsers ? "/admin/property-members" : null },
  ] : [];

  return (
    <main className="mx-auto grid max-w-[1480px] gap-5 p-4 lg:p-6" dir="rtl">
      <KoochPageHeader appearance="plain" eyebrow={null} title="داشبورد مدیریت"
        description="خلاصه اقامتگاه‌ها و کاربران ثبت‌شده در سامانه" />

      {loading ? (
        <KoochCard role="status">در حال دریافت اطلاعات داشبورد...</KoochCard>
      ) : error ? (
        <KoochAlert title={permissionDenied ? "دسترسی به داشبورد ندارید" : "داشبورد در دسترس نیست"} variant="destructive">
          <p>{permissionDenied ? "دسترسی مشاهده داشبورد برای حساب شما تأیید نشد." : error}</p>
          {!permissionDenied && <KoochButton className="mt-3" onClick={() => setRetry((value) => value + 1)} variant="outline">تلاش دوباره</KoochButton>}
        </KoochAlert>
      ) : dashboard && (
        <>
          <section aria-label="آمار داشبورد" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {counts.map(({ label, value, href }) => (
              <KoochCard className="min-w-0" key={label}>
                <p className="text-sm font-semibold text-muted-foreground">{label}</p>
                <p className="mt-2 text-3xl font-bold text-foreground">{number(value)}</p>
                {href && <Link className="mt-3 inline-block text-sm font-semibold text-primary underline-offset-4 hover:underline focus-visible:underline" href={href}>مشاهده فهرست</Link>}
              </KoochCard>
            ))}
          </section>

          <KoochCard>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-lg font-bold text-foreground">اقامتگاه‌های در انتظار بررسی</h2>
              {canManageProperties && dashboard.pendingProperties > 0 && (
                <Link className="text-sm font-semibold text-primary underline-offset-4 hover:underline focus-visible:underline" href="/admin/properties">همه اقامتگاه‌ها</Link>
              )}
            </div>
            {dashboard.pendingPropertyItems.length === 0 ? (
              <p className="mt-4 rounded-lg bg-muted p-4 text-sm text-muted-foreground" role="status">اقامتگاهی در انتظار بررسی نیست.</p>
            ) : (
              <ul className="mt-4 divide-y divide-border">
                {dashboard.pendingPropertyItems.map((property) => (
                  <li className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0" key={property.id}>
                    <div className="min-w-0">
                      <p className="font-semibold text-foreground">{property.name}</p>
                      <p className="text-sm text-muted-foreground">{property.ownerName}{property.destinationName ? ` · ${property.destinationName}` : ""}</p>
                    </div>
                    {canManageProperties && <Link className="text-sm font-semibold text-primary underline-offset-4 hover:underline focus-visible:underline" href={`/admin/properties/${property.id}`}>بررسی اقامتگاه</Link>}
                  </li>
                ))}
              </ul>
            )}
          </KoochCard>
        </>
      )}
    </main>
  );
}
