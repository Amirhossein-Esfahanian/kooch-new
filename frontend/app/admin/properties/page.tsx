"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiRequest, getToken, PropertyResponse } from "@/lib/owner-api";

type ReviewAction = "approve" | "reject" | "suspend";

const statusLabels: Record<string, string> = {
  PendingReview: "در انتظار بررسی",
  Approved: "تأیید شده",
  Rejected: "رد شده",
  Suspended: "تعلیق شده",
  Draft: "پیش‌نویس",
};

export default function AdminPropertiesPage() {
  const router = useRouter();
  const [properties, setProperties] = useState<PropertyResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [workingId, setWorkingId] = useState<number | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(async () => setProperties(await apiRequest<PropertyResponse[]>("/admin/properties")), []);

  useEffect(() => {
    if (!getToken()) {
      router.replace("/owner/login");
      return;
    }
    load().catch((caught: Error) => setError(caught.message)).finally(() => setLoading(false));
  }, [load, router]);

  async function review(id: number, action: ReviewAction) {
    setWorkingId(id);
    setError("");
    try {
      const updated = await apiRequest<PropertyResponse>(`/admin/properties/${id}/${action}`, { method: "PUT" });
      setProperties((current) => current.map((property) => property.id === id ? updated : property));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "تغییر وضعیت اقامتگاه انجام نشد.");
    } finally {
      setWorkingId(null);
    }
  }

  return (
    <div className="mx-auto max-w-6xl px-5 py-8 sm:px-8" dir="rtl">
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm font-bold text-slate-500">مدیریت کوچ</p>
          <h1 className="text-3xl font-black text-slate-950">بررسی و تأیید اقامتگاه‌ها</h1>
        </div>
        <Link className="rounded-lg border border-blue-600 bg-white px-4 py-2 text-sm font-bold text-blue-700 hover:bg-blue-50" href="/owner/properties">
          اقامتگاه‌های میزبان
        </Link>
      </div>
      {error && <p className="mb-4 text-sm font-semibold text-red-600">{error}</p>}
      {loading && <p className="rounded-xl border border-slate-200 bg-white p-5 text-slate-500">در حال بارگذاری اقامتگاه‌ها...</p>}
      {!loading && properties.length === 0 && <p className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center text-slate-500">اقامتگاهی پیدا نشد.</p>}
      <div className="grid gap-4">
        {properties.map((property) => (
          <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm" key={property.id}>
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h2 className="text-xl font-black text-slate-950">{property.name}</h2>
                {property.englishName && <p className="text-xs text-slate-400" dir="ltr">{property.englishName}</p>}
                <p className="mt-1 text-sm text-slate-500">{property.city} · میزبان: {property.ownerName || property.ownerId}</p>
                <p className="mt-2 text-sm font-bold text-slate-700">وضعیت: {statusLabels[property.status] ?? property.status}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-50" disabled={workingId === property.id} onClick={() => review(property.id, "approve")} type="button">تأیید</button>
                <button className="rounded-lg border border-red-200 bg-white px-3 py-2 text-sm font-bold text-red-700 hover:bg-red-50 disabled:opacity-50" disabled={workingId === property.id} onClick={() => review(property.id, "reject")} type="button">رد</button>
                <button className="rounded-lg border border-amber-200 bg-white px-3 py-2 text-sm font-bold text-amber-700 hover:bg-amber-50 disabled:opacity-50" disabled={workingId === property.id} onClick={() => review(property.id, "suspend")} type="button">تعلیق</button>
              </div>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
