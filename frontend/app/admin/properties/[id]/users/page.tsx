"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { AdminLayout } from "@/components/dashboard/DashboardLayouts";
import { KoochPageHeader } from "@/components/KoochPageHeader";
import { PropertyUsersManagement } from "@/components/property-users/PropertyUsersManagement";

const headerLinkClass =
  "inline-flex min-h-10 items-center justify-center rounded-md border border-border bg-background px-4 py-2 text-sm font-semibold text-foreground transition hover:bg-muted focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-background";

export default function AdminPropertyUsersPage() {
  const propertyId = Number(useParams<{ id: string }>().id);

  return (
    <AdminLayout>
      <main className="mx-auto grid max-w-[1480px] gap-5 p-4 lg:p-6">
        <KoochPageHeader
          actions={
            <>
              <Link
                className={headerLinkClass}
                href={`/admin/properties/${propertyId}`}
              >
                بازگشت به ویرایش اقامتگاه
              </Link>
              <Link className={headerLinkClass} href="/admin/properties">
                لیست اقامتگاه‌ها
              </Link>
            </>
          }
          description="تعریف و مدیریت کاربران عملیاتی همین اقامتگاه"
          eyebrow=""
          title="مدیریت کاربران"
        />
        <PropertyUsersManagement context="admin" propertyId={propertyId} />
      </main>
    </AdminLayout>
  );
}
