"use client";

import { useParams } from "next/navigation";
import { OwnerPanel } from "@/components/owner/OwnerPanel";

export default function OwnerChangeLogsPage() {
  const propertyId = Number(useParams<{ id: string }>().id);
  return (
    <OwnerPanel propertyId={propertyId} title="سوابق تغییرات نرخی">
      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-xl font-black">سوابق تغییرات نرخی</h2>
        <p className="mt-2 text-slate-500">پس از تکمیل قیمت‌گذاری، تغییرات نرخ در این بخش نمایش داده می‌شود.</p>
      </section>
    </OwnerPanel>
  );
}
