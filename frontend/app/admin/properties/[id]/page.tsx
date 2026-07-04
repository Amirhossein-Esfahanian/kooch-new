"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { AdminLayout } from "@/components/dashboard/DashboardLayouts";
import { KoochPageHeader } from "@/components/KoochPageHeader";
import { PropertyWizard } from "@/components/owner/PropertyWizard";
import {
  getPropertyFinancialWarnings,
  PricingSettingsWarning,
} from "@/components/pricing/PricingWarnings";
import { apiRequest, PropertyResponse } from "@/lib/owner-api";

const linkButtonClass =
  "inline-flex min-h-10 items-center justify-center rounded-md border px-4 py-2 text-center text-sm font-semibold transition focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-background";

export default function AdminPropertyEditPage() {
  const params = useParams<{ id: string }>();
  const propertyId = Number(params.id);
  const [property, setProperty] = useState<PropertyResponse | null>(null);

  useEffect(() => {
    apiRequest<PropertyResponse>(`/admin/properties/${propertyId}`)
      .then(setProperty)
      .catch(() => setProperty(null));
  }, [propertyId]);

  return (
    <AdminLayout>
      <main className="mx-auto grid max-w-[1480px] gap-5 p-4 lg:p-6">
        <KoochPageHeader
          actions={
            <>
              <Link
                className={`${linkButtonClass} border-border bg-background text-foreground hover:bg-muted`}
                href="/admin/properties"
              >
                بازگشت به مدیریت اقامتگاه‌ها
              </Link>
              <Link
                className={`${linkButtonClass} border-primary bg-primary text-primary-foreground hover:bg-[var(--primary-hover)]`}
                href={`/admin/properties/${propertyId}/rooms`}
              >
                مدیریت اتاق‌ها
              </Link>
            </>
          }
          description="ویرایش اطلاعات اقامتگاه در همان جریان مرحله‌ای مالک."
          eyebrow=""
          title="ویرایش اقامتگاه"
        />
        <PricingSettingsWarning
          editHref={`/admin/properties/${propertyId}?step=7`}
          warnings={getPropertyFinancialWarnings(property)}
        />
        <PropertyWizard isAdmin mode="edit" propertyId={propertyId} />
      </main>
    </AdminLayout>
  );
}
