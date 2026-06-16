"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ReactNode } from "react";
import { clearToken } from "@/lib/owner-api";

export function OwnerPage({ title, children }: { title: string; children: ReactNode }) {
  const router = useRouter();

  function logout() {
    clearToken();
    router.push("/owner/login");
  }

  return (
    <div className="mx-auto max-w-6xl px-5 py-8 sm:px-8">
      <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-slate-500">پنل مدیریت کوچ</p>
          <h1 className="text-3xl font-black text-slate-950">{title}</h1>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:border-blue-300 hover:text-blue-700" href="/owner/properties">
            اقامتگاه‌ها
          </Link>
          <Link className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:border-blue-300 hover:text-blue-700" href="/owner/amenities">
            امکانات
          </Link>
          <Link className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:border-blue-300 hover:text-blue-700" href="/admin/properties">
            مدیریت
          </Link>
          <button className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:border-blue-300 hover:text-blue-700" onClick={logout} type="button">
            خروج
          </button>
        </div>
      </div>
      {children}
    </div>
  );
}
