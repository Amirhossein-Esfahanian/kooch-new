"use client";

import { useParams } from "next/navigation";
import Link from "next/link";
import { AdminLayout } from "@/components/dashboard/DashboardLayouts";
import { KoochPageHeader } from "@/components/KoochPageHeader";
import { SettlementReceiptView } from "@/components/settlements/SettlementReceiptView";

export default function AdminSettlementReceiptPage() {
  const { settlementNumber } = useParams<{ settlementNumber: string }>();
  return <AdminLayout requiredPlatformPermission="ManagePayments">
    <main className="mx-auto grid w-full max-w-4xl gap-4 p-4 sm:p-6" dir="rtl">
      <KoochPageHeader title="رسید تسویه" eyebrow="پنل مدیریت" appearance="plain"
        actions={<Link href="/admin/settlements" className="text-sm text-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">بازگشت به تسویه‌ها</Link>} />
      <SettlementReceiptView key={settlementNumber} settlementNumber={settlementNumber} />
    </main>
  </AdminLayout>;
}
