"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { OwnerPanel } from "@/components/owner/OwnerPanel";
import { ThemeSelector } from "@/components/ThemeSelector";

export default function OwnerSettingsPage() {
  const propertyId = Number(useParams<{ id: string }>().id);
  return (
    <OwnerPanel propertyId={propertyId} title="تنظیمات">
      <div className="grid gap-5">
        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-[var(--shadow-subtle)]">
          <h2 className="text-xl font-black">تنظیمات اقامتگاه</h2>
          <p className="mt-2 text-slate-500">
            برای ویرایش کامل اطلاعات، از فرم کامل اقامتگاه استفاده کنید.
          </p>
          <Link
            className="ds-button-primary mt-5 inline-flex"
            href={`/owner/properties/${propertyId}`}
          >
            ویرایش کامل اقامتگاه
          </Link>
        </section>
        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-[var(--shadow-subtle)]">
          <ThemeSelector />
        </section>
      </div>
    </OwnerPanel>
  );
}
