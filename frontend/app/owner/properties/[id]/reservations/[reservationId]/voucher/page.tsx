"use client";

import { useParams, useRouter } from "next/navigation";
import { OwnerLayout } from "@/components/dashboard/DashboardLayouts";
import { KoochButton } from "@/components/KoochButton";
import { KoochPageHeader } from "@/components/KoochPageHeader";
import { OwnerVoucherView } from "@/components/reservations/vouchers/OwnerVoucherView";

export default function OwnerVoucherPage() {
  const { id, reservationId } = useParams<{ id: string; reservationId: string }>();
  const router = useRouter();
  return (
    <OwnerLayout>
      <div dir="rtl" className="mx-auto grid w-full max-w-4xl gap-4 p-4 sm:p-6">
        <KoochPageHeader title="ووچر رزرو" eyebrow="اقامتگاه" appearance="plain"
          actions={<KoochButton variant="outline" onClick={() => router.push(`/owner/properties/${id}/reservations`)}>بازگشت به رزروها</KoochButton>} />
        <OwnerVoucherView key={`${id}:${reservationId}`} propertyId={Number(id)} reservationId={Number(reservationId)} />
      </div>
    </OwnerLayout>
  );
}
