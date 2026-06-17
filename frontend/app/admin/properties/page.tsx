"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AdminPage } from "@/components/admin/AdminPage";
import { apiRequest, getToken, PropertyResponse, PropertyStatus } from "@/lib/owner-api";

const statuses: PropertyStatus[] = ["Draft", "PendingReview", "Approved", "Rejected", "Suspended"];
const statusLabels: Record<PropertyStatus, string> = {
  Draft: "پیش‌نویس",
  PendingReview: "در انتظار تایید",
  Approved: "تایید شده",
  Rejected: "رد شده",
  Suspended: "تعلیق شده",
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
      router.replace("/login");
      return;
    }
    load().catch((caught: Error) => setError(caught.message)).finally(() => setLoading(false));
  }, [load, router]);

  async function setStatus(id: number, status: PropertyStatus) {
    setWorkingId(id);
    setError("");
    try {
      const updated = await apiRequest<PropertyResponse>(`/admin/properties/${id}/status`, { method: "PUT", body: JSON.stringify({ status }) });
      setProperties((current) => current.map((property) => property.id === id ? updated : property));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "تغییر وضعیت اقامتگاه انجام نشد.");
    } finally {
      setWorkingId(null);
    }
  }

  return (
    <AdminPage title="مدیریت اقامتگاه‌ها">
      {error && <p className="mb-4 rounded-xl bg-red-50 p-4 text-sm font-semibold text-red-700">{error}</p>}
      {loading && <p className="rounded-xl border border-slate-200 bg-white p-5 text-slate-500">در حال بارگذاری اقامتگاه‌ها...</p>}
      {!loading && properties.length === 0 && <p className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center text-slate-500">اقامتگاهی پیدا نشد.</p>}
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="grid min-w-[980px] grid-cols-[70px_1.4fr_1fr_1.4fr_1fr_1fr_1.5fr] gap-3 border-b border-slate-100 bg-slate-50 px-4 py-3 text-xs font-black text-slate-500">
          <span>شناسه</span><span>نام</span><span>شهر</span><span>مالک</span><span>وضعیت</span><span>تاریخ ایجاد</span><span>عملیات</span>
        </div>
        <div className="overflow-x-auto">
          {properties.map((property) => (
            <div className="grid min-w-[980px] grid-cols-[70px_1.4fr_1fr_1.4fr_1fr_1fr_1.5fr] items-center gap-3 border-b border-slate-100 px-4 py-3 text-sm last:border-b-0" key={property.id}>
              <span className="font-bold text-slate-500">{property.id}</span>
              <div><p className="font-black text-slate-950">{property.name}</p>{property.englishName && <p className="text-xs text-slate-400" dir="ltr">{property.englishName}</p>}</div>
              <span>{property.city}</span>
              <span className="text-slate-600">{property.ownerName || property.ownerId}<br /><span className="text-xs text-slate-400">{property.ownerEmail}</span></span>
              <select className="rounded-lg border border-slate-300 px-2 py-2" disabled={workingId === property.id} onChange={(event) => setStatus(property.id, event.target.value as PropertyStatus)} value={property.status}>
                {statuses.map((status) => <option key={status} value={status}>{statusLabels[status]}</option>)}
              </select>
              <span className="text-xs text-slate-500">{new Date(property.createdAtUtc).toLocaleDateString("fa-IR")}</span>
              <div className="flex flex-wrap gap-2">
                <Link className="rounded-lg border border-blue-600 px-3 py-2 text-xs font-bold text-blue-700 hover:bg-blue-50" href={`/admin/properties/${property.id}`}>ویرایش</Link>
                <button className="rounded-lg bg-blue-600 px-3 py-2 text-xs font-bold text-white disabled:opacity-50" disabled={workingId === property.id} onClick={() => setStatus(property.id, "Approved")} type="button">تایید</button>
                <button className="rounded-lg border border-red-200 px-3 py-2 text-xs font-bold text-red-700 disabled:opacity-50" disabled={workingId === property.id} onClick={() => setStatus(property.id, "Rejected")} type="button">رد</button>
                <button className="rounded-lg border border-amber-200 px-3 py-2 text-xs font-bold text-amber-700 disabled:opacity-50" disabled={workingId === property.id} onClick={() => setStatus(property.id, "Suspended")} type="button">تعلیق</button>
                {property.status === "Approved" && <Link className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-bold text-slate-700" href={`/properties/${property.slug}`}>نمای عمومی</Link>}
              </div>
            </div>
          ))}
        </div>
      </div>
    </AdminPage>
  );
}
