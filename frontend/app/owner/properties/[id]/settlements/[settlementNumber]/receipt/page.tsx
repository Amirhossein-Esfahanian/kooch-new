"use client";

import { useParams } from "next/navigation";
import Link from "next/link";
import { OwnerLayout } from "@/components/dashboard/DashboardLayouts";
import { KoochPageHeader } from "@/components/KoochPageHeader";
import { SettlementReceiptView } from "@/components/settlements/SettlementReceiptView";

export default function OwnerSettlementReceiptPage() {
  const { id, settlementNumber } = useParams<{ id: string; settlementNumber: string }>();
  return <OwnerLayout>
    <main className="mx-auto grid w-full max-w-4xl gap-4 p-4 sm:p-6" dir="rtl">
      <KoochPageHeader title="رسید تسویه" eyebrow="اقامتگاه" appearance="plain"
        actions={<Link href={`/owner/properties/${id}`} className="text-sm text-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">بازگشت به اقامتگاه</Link>} />
      <SettlementReceiptView key={`${id}:${settlementNumber}`} propertyId={Number(id)} settlementNumber={settlementNumber} />
    </main>
  </OwnerLayout>;
}
