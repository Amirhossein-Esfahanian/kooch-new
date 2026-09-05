"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { AdminPropertyPanel } from "@/components/admin/AdminPropertyPanel";
import { ReservationFollowUpRecipients } from "@/components/admin/ReservationFollowUpRecipients";
import { PropertyWizard } from "@/components/owner/PropertyWizard";

const linkButtonClass =
  "inline-flex min-h-10 items-center justify-center rounded-md border px-4 py-2 text-center text-sm font-semibold transition focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-background";

export default function AdminPropertyEditPage() {
  const params = useParams<{ id: string }>();
  const propertyId = Number(params.id);

  return (
    <AdminPropertyPanel
      actions={
        <Link
          className={`${linkButtonClass} border-primary bg-primary text-primary-foreground hover:bg-[var(--primary-hover)]`}
          href={`/admin/properties/${propertyId}/rooms`}
        >
          مدیریت اتاق‌ها
        </Link>
      }
      description="ویرایش اطلاعات اقامتگاه در همان جریان مرحله‌ای مالک."
      propertyId={propertyId}
      showPricingWarnings={false}
      title="ویرایش اقامتگاه"
    >
      <PropertyWizard isAdmin mode="edit" propertyId={propertyId} />
      <ReservationFollowUpRecipients propertyId={propertyId} />
    </AdminPropertyPanel>
  );
}
