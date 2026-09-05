"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { AdminPropertyPanel } from "@/components/admin/AdminPropertyPanel";
import { RoomManagement } from "@/components/owner/RoomManagement";

const headerLinkClass =
  "inline-flex min-h-10 items-center justify-center rounded-md border border-border bg-background px-4 py-2 text-sm font-semibold text-foreground transition hover:bg-muted focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-background";

export default function AdminPropertyRoomsPage() {
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
      description="ایجاد، ویرایش، فعال‌سازی و مدیریت تصاویر اتاق‌ها"
      propertyId={propertyId}
      sectionLabel="اتاق‌ها"
      showPricingWarnings={false}
      title="مدیریت اتاق‌ها"
    >
      <RoomManagement compactHeader propertyId={propertyId} />
    </AdminPropertyPanel>
  );
}
