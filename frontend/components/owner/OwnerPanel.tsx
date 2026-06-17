"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ReactNode, useEffect, useState } from "react";
import {
  apiRequest,
  getToken,
  ownerPropertyKey,
  PropertyResponse,
} from "@/lib/owner-api";

const navItems = [
  { label: "داشبورد", icon: "▦", href: "dashboard" },
  { label: "اقامتگاه من", icon: "⌂", href: "" },
  { label: "اتاق‌ها", icon: "▤", href: "rooms" },
  { label: "ظرفیت اتاق‌ها", icon: "▣", href: "inventory" },
  { label: "قیمت‌گذاری اتاق‌ها", icon: "▥", href: "pricing" },
  { label: "رزروها", icon: "●", href: "reservations" },
  { label: "نظرات", icon: "□", href: "reviews" },
  { label: "کاربران", icon: "♟", href: "users" },
  { label: "سوابق تغییرات نرخی", icon: "≡", href: "change-logs" },
  { label: "تنظیمات", icon: "⚙", href: "settings" },
];

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
  const pathname = usePathname();
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

  const base = `/owner/properties/${propertyId}`;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900" dir="rtl">
      <div className="mx-auto grid max-w-7xl gap-6 px-4 py-5 md:grid-cols-[250px_minmax(0,1fr)] lg:px-6">
        <aside className="h-fit rounded-2xl border border-slate-200 bg-white p-3 md:sticky md:top-5">
          <div className="mb-4 rounded-xl bg-blue-600 px-4 py-3 text-white">
            <p className="text-xs font-bold opacity-80">پنل مالک</p>
            <p className="mt-1 truncate text-sm font-black">
              {property?.name ?? "انتخاب اقامتگاه"}
            </p>
          </div>
          <nav className="grid gap-1">
            {navItems.map((item) => {
              const href = item.href
                ? `${base}/${item.href}`
                : `/owner/properties/${propertyId}`;
              const active = item.href
                ? pathname === href
                : pathname === `/owner/properties/${propertyId}`;
              return (
                <Link
                  className={`flex items-center justify-between rounded-2xl px-4 py-3 text-sm font-bold transition ${active ? "bg-blue-50 text-blue-700" : "text-slate-700 hover:bg-slate-100"}`}
                  href={href}
                  key={item.label}
                >
                  <span>{item.label}</span>
                  <span className="grid h-7 w-7 place-items-center rounded-lg text-lg text-blue-700">
                    {item.icon}
                  </span>
                </Link>
              );
            })}
          </nav>
        </aside>

        <main className="min-w-0">
          <header className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-4">
            <div>
              <p className="text-xs font-bold text-slate-400">اقامتگاه فعال</p>
              <h1 className="mt-1 text-2xl font-black">{title}</h1>
              <p className="mt-1 text-sm font-semibold text-slate-500">
                {property?.name ?? "در حال بارگذاری..."}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link
                className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-bold text-slate-700 hover:border-blue-300 hover:text-blue-700"
                href="/owner/select-property"
              >
                تغییر اقامتگاه
              </Link>
              {property?.slug && (
                <Link
                  className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-bold text-white hover:bg-blue-700"
                  href={`/properties/${property.slug}`}
                >
                  مشاهده صفحه عمومی
                </Link>
              )}
            </div>
          </header>
          {error && (
            <p className="mb-4 rounded-xl bg-red-50 p-3 text-sm font-semibold text-red-700">
              {error}
            </p>
          )}
          {children}
        </main>
      </div>
    </div>
  );
}
