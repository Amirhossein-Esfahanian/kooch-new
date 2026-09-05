"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { AdminPropertyPanel } from "@/components/admin/AdminPropertyPanel";
import { OwnerInventoryGrid } from "@/components/owner/OwnerInventoryGrid";

const headerLinkClass =
  "inline-flex min-h-10 items-center justify-center rounded-md border border-border bg-background px-4 py-2 text-sm font-semibold text-foreground transition hover:bg-muted focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-background";

export default function AdminInventoryPage() {
  const params = useParams<{ id: string }>();
  const propertyId = Number(params.id);

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
      description="مدیریت ظرفیت روزانه اتاق‌ها در بستر پنل مدیریت"
      propertyId={propertyId}
      sectionLabel="ظرفیت"
      showPricingWarnings={false}
      title="ظرفیت اتاق‌ها"
    >
      <OwnerInventoryGrid context="admin" propertyId={propertyId} />
    </AdminPropertyPanel>
  );
}
