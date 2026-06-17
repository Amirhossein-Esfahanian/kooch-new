"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  apiRequest,
  getToken,
  ownerPropertyKey,
  PropertyResponse,
} from "@/lib/owner-api";

export default function SelectOwnerPropertyPage() {
  const router = useRouter();
  const [properties, setProperties] = useState<PropertyResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!getToken()) {
      router.replace("/login");
      return;
    }
    apiRequest<PropertyResponse[]>("/owner/properties")
      .then((items) => {
        if (items.length === 1) {
          localStorage.setItem(ownerPropertyKey, items[0].id.toString());
          router.replace(`/owner/properties/${items[0].id}/dashboard`);
          return;
        }
        setProperties(items);
      })
      .catch((caught: Error) => setError(caught.message))
      .finally(() => setLoading(false));
  }, [router]);

  function selectProperty(property: PropertyResponse) {
    localStorage.setItem(ownerPropertyKey, property.id.toString());
    router.push(`/owner/properties/${property.id}/dashboard`);
  }

  return (
    <main className="mx-auto max-w-5xl px-5 py-10 sm:px-8" dir="rtl">
      <div className="mb-8">
        <p className="text-sm font-black text-blue-700">انتخاب اقامتگاه</p>
        <h1 className="mt-2 text-3xl font-black text-slate-950">
          کدام اقامتگاه را مدیریت می‌کنید؟
        </h1>
      </div>
      {loading && (
        <p className="rounded-2xl border bg-white p-5 text-slate-500">
          در حال بارگذاری...
        </p>
      )}
      {error && <p className="text-sm font-semibold text-red-600">{error}</p>}
      {!loading && properties.length === 0 && (
        <section className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center">
          <p className="text-slate-500">
            هنوز اقامتگاهی برای شما ثبت نشده است.
          </p>
          <Link
            className="mt-5 inline-flex rounded-xl bg-blue-600 px-5 py-3 font-black text-white hover:bg-blue-700"
            href="/owner/properties/new"
          >
            افزودن اقامتگاه جدید
          </Link>
        </section>
      )}
      <div className="grid gap-4 md:grid-cols-2">
        {properties.map((property) => (
          <button
            className="rounded-2xl border border-slate-200 bg-white p-5 text-right shadow-sm hover:border-blue-300"
            key={property.id}
            onClick={() => selectProperty(property)}
            type="button"
          >
            <span className="text-xl font-black text-slate-950">
              {property.name}
            </span>
            <span className="mt-2 block text-sm text-slate-500">
              {property.city} · {property.status}
            </span>
            <span className="mt-5 inline-flex rounded-xl bg-blue-600 px-4 py-2 text-sm font-bold text-white">
              ورود به پنل
            </span>
          </button>
        ))}
      </div>
    </main>
  );
}
