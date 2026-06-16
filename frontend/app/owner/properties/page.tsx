"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { OwnerPage } from "@/components/owner/OwnerPage";
import { apiRequest, getToken, PropertyResponse } from "@/lib/owner-api";

const statusLabels: Record<string, string> = {
  Draft: "پیش‌نویس",
  PendingReview: "در انتظار بررسی",
  Approved: "تأیید شده",
  Rejected: "رد شده",
  Suspended: "تعلیق شده",
};

export default function OwnerPropertiesPage() {
  const router = useRouter();
  const [properties, setProperties] = useState<PropertyResponse[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!getToken()) {
      router.replace("/owner/login");
      return;
    }
    apiRequest<PropertyResponse[]>("/owner/properties")
      .then(setProperties)
      .catch((caught: Error) => setError(caught.message))
      .finally(() => setLoading(false));
  }, [router]);

  return (
    <OwnerPage title="اقامتگاه‌ها">
      <div className="mb-5 flex justify-end">
        <Link className="rounded-xl bg-blue-600 px-4 py-3 font-bold text-white hover:bg-blue-700" href="/owner/properties/new">
          افزودن اقامتگاه
        </Link>
      </div>
      {loading && <p className="rounded-xl border border-slate-200 bg-white p-5 text-slate-500">در حال بارگذاری اقامتگاه‌ها...</p>}
      {error && <p className="text-sm font-semibold text-red-600">{error}</p>}
      {!loading && !error && properties.length === 0 && <p className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center text-slate-500">هنوز اقامتگاهی ثبت نشده است.</p>}
      <div className="grid gap-4">
        {properties.map((property) => (
          <article className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm" key={property.id}>
            <div>
              <h2 className="text-xl font-bold text-slate-950">{property.name}</h2>
              <p className="mt-1 text-sm text-slate-500">{property.city} · {statusLabels[property.status] ?? property.status}</p>
            </div>
            <Link className="rounded-lg border border-blue-600 px-4 py-2 text-sm font-semibold text-blue-700 hover:bg-blue-50" href={`/owner/properties/${property.id}`}>
              ویرایش و مدیریت
            </Link>
          </article>
        ))}
      </div>
    </OwnerPage>
  );
}
