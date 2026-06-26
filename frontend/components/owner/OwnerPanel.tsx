"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ReactNode, useEffect, useState } from "react";
import { OwnerLayout } from "@/components/dashboard/DashboardLayouts";
import {
  apiRequest,
  getToken,
  ownerPropertyKey,
  PropertyResponse,
} from "@/lib/owner-api";

export function OwnerPanel({
  propertyId,
  title,
  children,
}: {
  propertyId: number;
  title: string;
  children: ReactNode;
}) {
  const router = useRouter();
  const [property, setProperty] = useState<PropertyResponse | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!getToken()) {
      router.replace("/login");
      return;
    }
    localStorage.setItem(ownerPropertyKey, propertyId.toString());
    apiRequest<PropertyResponse>(`/owner/properties/${propertyId}`)
      .then(setProperty)
      .catch((caught: Error) => setError(caught.message));
  }, [propertyId, router]);

  return (
    <OwnerLayout>
      <main className="mx-auto grid max-w-[1480px] gap-5 p-4 lg:p-6">
        <header className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-[#171d27]">
          <div>
            <p className="text-xs font-bold text-slate-400">اقامتگاه فعال</p>
            <h1 className="mt-1 text-2xl font-black text-slate-950 dark:text-slate-100">{title}</h1>
            <p className="mt-1 text-sm font-semibold text-slate-500 dark:text-slate-400">
              {property?.name ?? "در حال بارگذاری..."}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link className="ds-button-secondary text-sm" href="/owner/select-property">
              تغییر اقامتگاه
            </Link>
            {property?.slug && (
              <Link className="ds-button-primary text-sm" href={`/properties/${property.slug}`}>
                مشاهده صفحه عمومی
              </Link>
            )}
          </div>
        </header>
        {error && (
          <p className="rounded-xl bg-red-50 p-3 text-sm font-semibold text-red-700">
            {error}
          </p>
        )}
        {children}
      </main>
    </OwnerLayout>
  );
}
