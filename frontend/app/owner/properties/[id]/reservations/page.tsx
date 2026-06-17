"use client";

import { useParams } from "next/navigation";
import { OwnerPanel } from "@/components/owner/OwnerPanel";

export default function OwnerReservationsPage() {
  const propertyId = Number(useParams<{ id: string }>().id);
  return (
    <OwnerPanel propertyId={propertyId} title="لیست رزروها">
      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-xl font-black">لیست رزروها</h2>
        <p className="mt-2 text-slate-500">موتور رزرو هنوز پیاده‌سازی نشده است.</p>
      </section>
    </OwnerPanel>
  );
}
