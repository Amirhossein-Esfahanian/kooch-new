"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AdminPage } from "@/components/admin/AdminPage";
import { AdminDashboardResponse, apiRequest, getToken } from "@/lib/owner-api";

const statusLabels: Record<string, string> = {
  PendingReview: "در انتظار تایید",
  Approved: "تایید شده",
  Rejected: "رد شده",
  Suspended: "تعلیق شده",
  Draft: "پیش‌نویس",
};

export default function AdminDashboardPage() {
  const router = useRouter();
  const [dashboard, setDashboard] = useState<AdminDashboardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!getToken()) {
      router.replace("/login");
      return;
    }
    apiRequest<AdminDashboardResponse>("/admin/dashboard")
      .then(setDashboard)
      .catch((caught: Error) => setError(caught.message))
      .finally(() => setLoading(false));
  }, [router]);

  const cards = dashboard
    ? [
        ["تعداد کل اقامتگاه‌ها", dashboard.totalProperties],
        ["اقامتگاه‌های منتظر تایید", dashboard.pendingProperties],
        ["اقامتگاه‌های تایید شده", dashboard.approvedProperties],
        ["تعداد کاربران", dashboard.totalUsers],
        ["تعداد مالک‌ها", dashboard.totalOwners],
      ]
    : [];

  return (
    <AdminPage title="داشبورد مدیریت">
      {loading && <p className="rounded-xl border border-slate-200 bg-white p-5 text-slate-500">در حال بارگذاری داشبورد...</p>}
      {error && <p className="rounded-xl bg-red-50 p-4 text-sm font-bold text-red-700">{error}</p>}
      {dashboard && (
        <div className="grid gap-6">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            {cards.map(([title, value]) => (
              <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm" key={title}>
                <p className="text-sm font-bold text-slate-500">{title}</p>
                <p className="mt-3 text-3xl font-black text-blue-700">{value}</p>
              </article>
            ))}
          </div>

          {dashboard.pendingPropertyItems.length > 0 && (
            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="text-xl font-black text-slate-950">اقامتگاه‌های در انتظار تایید</h2>
              <div className="mt-4 grid gap-3">
                {dashboard.pendingPropertyItems.map((property) => (
                  <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-100 p-4" key={property.id}>
                    <div>
                      <p className="font-black text-slate-950">{property.name}</p>
                      <p className="mt-1 text-sm text-slate-500">{property.city} · مالک: {property.ownerName || property.ownerEmail} · {statusLabels[property.status] ?? property.status}</p>
                    </div>
                    <Link className="rounded-lg border border-blue-600 px-4 py-2 text-sm font-bold text-blue-700 hover:bg-blue-50" href={`/admin/properties/${property.id}`}>
                      مشاهده / ویرایش
                    </Link>
                  </div>
                ))}
              </div>
            </section>
          )}

          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm" id="reports">
            <h2 className="text-xl font-black text-slate-950">گزارش‌ها</h2>
            <p className="mt-2 text-sm leading-6 text-slate-500">گزارش‌ها در این مرحله از داده‌های دیتابیس تولید می‌شوند و فایل جداگانه‌ای ذخیره نمی‌شود.</p>
          </section>
        </div>
      )}
    </AdminPage>
  );
}
