"use client";

import { useParams, useRouter } from "next/navigation";
import { AdminLayout } from "@/components/dashboard/DashboardLayouts";
import { KoochButton } from "@/components/KoochButton";
import { KoochPageHeader } from "@/components/KoochPageHeader";
import { AdminVoucherView } from "@/components/reservations/vouchers/AdminVoucherView";

export default function AdminVoucherPage() {
  const { reservationId } = useParams<{ reservationId: string }>();
  const router = useRouter();
  return (
    <AdminLayout requiredPlatformPermission="ManagePayments">
      <div dir="rtl" className="mx-auto grid w-full max-w-4xl gap-4 p-4 sm:p-6">
        <KoochPageHeader title="ووچر رزرو" eyebrow="پنل مدیریت" appearance="plain"
          actions={<KoochButton variant="outline" onClick={() => router.push("/admin/reservations")}>بازگشت به رزروها</KoochButton>} />
        <AdminVoucherView key={reservationId} reservationId={Number(reservationId)} />
      </div>
    </AdminLayout>
  );
}
