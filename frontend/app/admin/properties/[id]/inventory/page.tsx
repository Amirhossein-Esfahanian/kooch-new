"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { KoochPageHeader } from "@/components/KoochPageHeader";
import { AdminLayout } from "@/components/dashboard/DashboardLayouts";
import { OwnerInventoryGrid } from "@/components/owner/OwnerInventoryGrid";

const headerLinkClass =
  "inline-flex min-h-10 items-center justify-center rounded-md border border-border bg-background px-4 py-2 text-sm font-semibold text-foreground transition hover:bg-muted focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-background";

export default function AdminInventoryPage() {
  const params = useParams<{ id: string }>();
  const propertyId = Number(params.id);

  return (
    <AdminLayout>
      <main className="mx-auto grid max-w-[1480px] gap-5 p-4 lg:p-6">
        <KoochPageHeader
          actions={
            <>
              <Link className={headerLinkClass} href={`/admin/properties/${propertyId}`}>
                بازگشت به ویرایش اقامتگاه
              </Link>
              <Link className={headerLinkClass} href="/admin/properties">
                لیست اقامتگاه‌ها
              </Link>
            </>
          }
          description="مدیریت ظرفیت روزانه اتاق‌ها در بستر پنل مدیریت"
          eyebrow="پنل مدیریت"
          title="ظرفیت اتاق‌ها"
        />
        <OwnerInventoryGrid context="admin" propertyId={propertyId} />
      </main>
    </AdminLayout>
  );
}
