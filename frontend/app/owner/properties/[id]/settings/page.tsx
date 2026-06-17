"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { OwnerPanel } from "@/components/owner/OwnerPanel";

export default function OwnerSettingsPage() {
  const propertyId = Number(useParams<{ id: string }>().id);
  return (
    <OwnerPanel propertyId={propertyId} title="تنظیمات">
      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-xl font-black">تنظیمات اقامتگاه</h2>
        <p className="mt-2 text-slate-500">
          برای ویرایش کامل اطلاعات، از فرم کامل اقامتگاه استفاده کنید.
        </p>
        <Link
          className="mt-5 inline-flex rounded-xl bg-blue-600 px-4 py-2 font-bold text-white hover:bg-blue-700"
          href={`/owner/properties/${propertyId}`}
        >
          ویرایش کامل اقامتگاه
        </Link>
      </section>
    </OwnerPanel>
  );
}
