"use client";

import { OwnerLayout } from "@/components/dashboard/DashboardLayouts";
import { KoochPageHeader } from "@/components/KoochPageHeader";
import { PropertyWizard } from "@/components/owner/PropertyWizard";

export default function NewPropertyPage() {
  return (
    <OwnerLayout>
      <main className="mx-auto grid max-w-[1480px] gap-5 p-4 lg:p-6">
        <KoochPageHeader
          description="اطلاعات اقامتگاه را مرحله‌به‌مرحله تکمیل کنید."
          eyebrow="پنل مالک"
          title="ثبت اقامتگاه"
        />
        <PropertyWizard mode="create" />
      </main>
    </OwnerLayout>
  );
}
