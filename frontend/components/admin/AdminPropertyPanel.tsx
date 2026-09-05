"use client";

import Link from "next/link";
import { ReactNode, useEffect, useState } from "react";
import { useAuthSession } from "@/components/auth/AuthSessionProvider";
import { AdminLayout } from "@/components/dashboard/DashboardLayouts";
import { KoochPageHeader } from "@/components/KoochPageHeader";
import {
  getPropertyFinancialWarnings,
  PricingSettingsWarning,
} from "@/components/pricing/PricingWarnings";
import { apiRequest, PropertyResponse } from "@/lib/owner-api";

export function AdminPropertyPanel({
  actions,
  children,
  description,
  propertyId,
  sectionLabel,
  showPricingWarnings = true,
  title,
}: {
  actions?: ReactNode;
  children: ReactNode;
  description?: ReactNode;
  propertyId: number;
  sectionLabel?: string;
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
        <KoochPageHeader
          actions={actions}
          appearance="plain"
          breadcrumb={
            <>
              <li>
                <Link
                  className="rounded-sm transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  href="/admin"
                >
                  پنل مدیریت
                </Link>
              </li>
              <li aria-hidden="true">/</li>
              <li>
                <Link
                  className="rounded-sm transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  href="/admin/properties"
                >
                  اقامتگاه‌ها
                </Link>
              </li>
              <li aria-hidden="true">/</li>
              {sectionLabel && property ? (
                <li>
                  <Link
                    className="rounded-sm transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    href={`/admin/properties/${propertyId}`}
                  >
                    {property.name}
                  </Link>
                </li>
              ) : (
                <li aria-current={sectionLabel ? undefined : "page"}>
                  {property?.name ?? "در حال بارگذاری..."}
                </li>
              )}
              {sectionLabel && (
                <>
                  <li aria-hidden="true">/</li>
                  <li aria-current="page">{sectionLabel}</li>
                </>
              )}
            </>
          }
          description={description}
          eyebrow=""
          title={title}
        />
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
