"use client";

import { useParams } from "next/navigation";
import { OwnerPanel } from "@/components/owner/OwnerPanel";

export default function OwnerReviewsPage() {
  const propertyId = Number(useParams<{ id: string }>().id);
  return (
    <OwnerPanel propertyId={propertyId} title="نظرات">
      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-xl font-black">نظرات</h2>
        <p className="mt-2 text-slate-500">نمایش و پاسخ به نظرات در مرحله بعد تکمیل می‌شود.</p>
      </section>
    </OwnerPanel>
  );
}
