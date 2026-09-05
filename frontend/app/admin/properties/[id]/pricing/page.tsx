"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { AdminPropertyPanel } from "@/components/admin/AdminPropertyPanel";
import { OwnerPricingGrid } from "@/components/owner/OwnerPricingGrid";

const headerLinkClass =
  "inline-flex min-h-10 items-center justify-center rounded-md border border-border bg-background px-4 py-2 text-sm font-semibold text-foreground transition hover:bg-muted focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-background";

export default function AdminPricingPage() {
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
      description="مدیریت قیمت روزانه اتاق‌ها در بستر پنل مدیریت"
      propertyId={propertyId}
      sectionLabel="قیمت‌گذاری"
      showPricingWarnings={false}
      title="قیمت‌گذاری اتاق‌ها"
    >
      <OwnerPricingGrid context="admin" propertyId={propertyId} />
    </AdminPropertyPanel>
  );
}
