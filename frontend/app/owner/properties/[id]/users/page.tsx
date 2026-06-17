"use client";

import { useParams } from "next/navigation";
import { OwnerPanel } from "@/components/owner/OwnerPanel";

export default function OwnerUsersPage() {
  const propertyId = Number(useParams<{ id: string }>().id);
  return (
    <OwnerPanel propertyId={propertyId} title="کاربران">
      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-xl font-black">کاربران اقامتگاه</h2>
        <p className="mt-2 text-slate-500">مدیریت کارکنان این اقامتگاه بعداً به این بخش اضافه می‌شود.</p>
      </section>
    </OwnerPanel>
  );
}
