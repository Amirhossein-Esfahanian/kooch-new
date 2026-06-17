"use client";

import { useParams } from "next/navigation";
import { OwnerPanel } from "@/components/owner/OwnerPanel";

export default function OwnerPricingPage() {
  const propertyId = Number(useParams<{ id: string }>().id);
  return (
    <OwnerPanel propertyId={propertyId} title="قیمت‌گذاری اتاق‌ها">
      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-xl font-black">قیمت‌گذاری اتاق‌ها</h2>
        <p className="mt-2 text-slate-500">این بخش بعداً برای مدیریت قیمت روزانه تکمیل می‌شود.</p>
      </section>
    </OwnerPanel>
  );
}
