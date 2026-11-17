"use client";

import { Suspense } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { safeReservationReturnHref } from "@/components/reservations/admin-reservation-navigation";
import { AdminLayout } from "@/components/dashboard/DashboardLayouts";
import { KoochButton } from "@/components/KoochButton";
import { KoochPageHeader } from "@/components/KoochPageHeader";
import { AdminVoucherView } from "@/components/reservations/vouchers/AdminVoucherView";

export default function AdminVoucherPage() {
  return <Suspense fallback={null}><VoucherContent /></Suspense>;
}

function VoucherContent() {
  const { reservationId } = useParams<{ reservationId: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const returnHref = safeReservationReturnHref(searchParams.get("returnTo"));
  return (
    <AdminLayout requiredPlatformPermission="ManagePayments">
      <div dir="rtl" className="mx-auto grid w-full max-w-4xl gap-4 p-4 sm:p-6">
        <KoochPageHeader title="ووچر رزرو" eyebrow="پنل مدیریت" appearance="plain"
          actions={<KoochButton variant="outline" onClick={() => router.push(returnHref)}>بازگشت به رزروها</KoochButton>} />
        <AdminVoucherView key={reservationId} reservationId={Number(reservationId)} />
      </div>
    </AdminLayout>
  );
}
