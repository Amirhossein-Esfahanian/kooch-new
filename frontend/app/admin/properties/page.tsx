"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiRequest, getToken, PropertyResponse } from "@/lib/owner-api";

type ReviewAction = "approve" | "reject" | "suspend";

const statusLabels: Record<string, string> = { PendingReview: "در انتظار بررسی", Approved: "تأییدشده", Rejected: "ردشده", Suspended: "تعلیق‌شده" };

export default function AdminPropertiesPage() {
  const router = useRouter();
  const [properties, setProperties] = useState<PropertyResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [workingId, setWorkingId] = useState<number | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(async () => setProperties(await apiRequest<PropertyResponse[]>("/admin/properties")), []);

  useEffect(() => { if (!getToken()) { router.replace("/owner/login"); return; } load().catch((caught: Error) => setError(caught.message)).finally(() => setLoading(false)); }, [load, router]);

  async function review(id: number, action: ReviewAction) {
    setWorkingId(id); setError("");
    try { const updated = await apiRequest<PropertyResponse>(`/admin/properties/${id}/${action}`, { method: "PUT" }); setProperties((current) => current.map((property) => property.id === id ? updated : property)); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "تغییر وضعیت اقامتگاه انجام نشد."); }
    finally { setWorkingId(null); }
  }

  return <div className="mx-auto max-w-6xl px-5 py-10 sm:px-8" dir="rtl">
    <div className="mb-8 flex flex-wrap items-end justify-between gap-4"><div><p className="text-sm font-bold text-ink/50">مدیریت کوچ</p><h1 className="text-3xl font-black">بررسی و تأیید اقامتگاه‌ها</h1></div><Link className="rounded-lg border border-ink/20 px-4 py-2 text-sm font-bold" href="/owner/properties">اقامتگاه‌های میزبان</Link></div>
    {error && <p className="mb-4 rounded-lg bg-red-50 p-3 text-red-700">{error}</p>}
    {loading && <p>در حال بارگذاری اقامتگاه‌ها...</p>}
    {!loading && properties.length === 0 && <p className="rounded-xl border border-dashed border-ink/20 p-8 text-center">اقامتگاهی پیدا نشد.</p>}
    <div className="grid gap-4">{properties.map((property) => <article className="rounded-xl border border-ink/10 bg-white p-5 shadow-sm" key={property.id}><div className="flex flex-wrap items-start justify-between gap-4"><div><h2 className="text-xl font-black">{property.name}</h2>{property.englishName && <p className="text-xs text-ink/40" dir="ltr">{property.englishName}</p>}<p className="mt-1 text-sm text-ink/60">{property.city} · میزبان: {property.ownerName || property.ownerId}</p><p className="mt-2 text-sm font-bold">وضعیت: {statusLabels[property.status] ?? property.status}</p></div><div className="flex flex-wrap gap-2"><button className="rounded-lg bg-green-700 px-3 py-2 text-sm font-bold text-white disabled:opacity-50" disabled={workingId === property.id} onClick={() => review(property.id, "approve")} type="button">تأیید</button><button className="rounded-lg bg-red-700 px-3 py-2 text-sm font-bold text-white disabled:opacity-50" disabled={workingId === property.id} onClick={() => review(property.id, "reject")} type="button">رد</button><button className="rounded-lg bg-amber-700 px-3 py-2 text-sm font-bold text-white disabled:opacity-50" disabled={workingId === property.id} onClick={() => review(property.id, "suspend")} type="button">تعلیق</button></div></div></article>)}</div>
  </div>;
}
