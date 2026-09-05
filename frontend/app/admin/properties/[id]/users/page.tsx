"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { AdminPropertyPanel } from "@/components/admin/AdminPropertyPanel";
import { PropertyUsersManagement } from "@/components/property-users/PropertyUsersManagement";

const headerLinkClass =
  "inline-flex min-h-10 items-center justify-center rounded-md border border-border bg-background px-4 py-2 text-sm font-semibold text-foreground transition hover:bg-muted focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-background";

export default function AdminPropertyUsersPage() {
  const propertyId = Number(useParams<{ id: string }>().id);

  return (
    <AdminPropertyPanel
      actions={
        <Link
          className={headerLinkClass}
          href={`/admin/properties/${propertyId}`}
        >
          بازگشت به ویرایش اقامتگاه
        </Link>
      }
      description="تعریف و مدیریت کاربران عملیاتی همین اقامتگاه"
      propertyId={propertyId}
      sectionLabel="کاربران"
      showPricingWarnings={false}
      title="مدیریت کاربران"
    >
      <PropertyUsersManagement context="admin" propertyId={propertyId} />
    </AdminPropertyPanel>
  );
}
