"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { OwnerLayout } from "@/components/dashboard/DashboardLayouts";
import { KoochPageHeader } from "@/components/KoochPageHeader";
import { PropertyWizard } from "@/components/owner/PropertyWizard";

const linkButtonClass =
  "inline-flex min-h-10 items-center justify-center rounded-md border px-4 py-2 text-center text-sm font-semibold transition focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-background";

export default function ManagePropertyPage() {
  const params = useParams<{ id: string }>();
  const propertyId = Number(params.id);

  return (
    <OwnerLayout>
      <main className="mx-auto grid max-w-[1480px] gap-5 p-4 lg:p-6">
        <KoochPageHeader
          actions={
            <>
              <Link
                className={`${linkButtonClass} border-border bg-background text-foreground hover:bg-muted`}
                href="/owner/properties"
              >
                بازگشت به اقامتگاه‌ها
              </Link>
              <Link
                className={`${linkButtonClass} border-primary bg-primary text-primary-foreground hover:bg-[var(--primary-hover)]`}
                href={`/owner/properties/${propertyId}/rooms`}
              >
                مدیریت اتاق‌ها
              </Link>
            </>
          }
          description="اطلاعات، امکانات، تصاویر و قوانین اقامتگاه را ویرایش کنید."
          eyebrow="پنل مالک"
          title="ویرایش اقامتگاه"
        />
        <PropertyWizard mode="edit" propertyId={propertyId} />
      </main>
    </OwnerLayout>
  );
}
