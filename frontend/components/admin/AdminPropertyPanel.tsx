"use client";

import Link from "next/link";
import { ReactNode, useEffect, useState } from "react";
import { useAuthSession } from "@/components/auth/AuthSessionProvider";
import { AdminLayout } from "@/components/dashboard/DashboardLayouts";
import {
  getPropertyFinancialWarnings,
  PricingSettingsWarning,
} from "@/components/pricing/PricingWarnings";
import { apiRequest, PropertyResponse } from "@/lib/owner-api";

export function AdminPropertyPanel({
  children,
  propertyId,
  showPricingWarnings = true,
  title,
}: {
  children: ReactNode;
  propertyId: number;
  showPricingWarnings?: boolean;
  title: string;
}) {
  const { authenticated, loading, workspaces } = useAuthSession();
  const [property, setProperty] = useState<PropertyResponse | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (loading || !authenticated || !workspaces.includes("admin")) return;

    apiRequest<PropertyResponse>(`/admin/properties/${propertyId}`)
      .then(setProperty)
      .catch((caught: Error) => setError(caught.message));
  }, [authenticated, loading, propertyId, workspaces]);

  return (
    <AdminLayout>
      <main className="mx-auto grid max-w-[1480px] gap-5 p-4 lg:p-6">
        <header className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-[#171d27]">
          <div>
            <p className="text-xs font-bold text-slate-400">پنل مدیریت</p>
            <h1 className="mt-1 text-2xl font-black text-slate-950 dark:text-slate-100">{title}</h1>
            <p className="mt-1 text-sm font-semibold text-slate-500 dark:text-slate-400">
              {property?.name ?? "در حال بارگذاری..."}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link className="ds-button-secondary text-sm" href="/admin/properties">
              بازگشت به لیست
            </Link>
            {property?.slug && (
              <Link className="ds-button-primary text-sm" href={`/properties/${property.slug}`}>
                مشاهده صفحه عمومی
              </Link>
            )}
          </div>
        </header>
        {error && (
          <p className="rounded-xl bg-red-50 p-3 text-sm font-semibold text-red-700">
            {error}
          </p>
        )}
        {showPricingWarnings && (
          <PricingSettingsWarning
            editHref={`/admin/properties/${propertyId}?step=7`}
            warnings={getPropertyFinancialWarnings(property)}
          />
        )}
        {children}
      </main>
    </AdminLayout>
  );
}
