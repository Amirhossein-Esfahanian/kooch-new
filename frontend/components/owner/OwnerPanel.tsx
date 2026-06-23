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
  { label: "پروموشن‌ها", icon: "%", href: "promotions" },
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
      <div className="mx-auto grid max-w-7xl gap-7 px-4 py-6 md:grid-cols-[270px_minmax(0,1fr)] lg:px-6">
        <aside className="h-fit rounded-2xl border border-slate-200 bg-white p-3 shadow-[var(--shadow-subtle)] md:sticky md:top-5">
          <div className="mb-4 rounded-2xl bg-[var(--theme-primary)] px-4 py-4 text-white">
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
                  className={`flex items-center justify-between rounded-2xl px-4 py-3 text-sm font-bold transition ${
                    active
                      ? "bg-[var(--theme-primary-soft)] text-[var(--theme-primary-text)]"
                      : "text-slate-700 hover:bg-slate-100"
                  }`}
                  href={href}
                  key={item.label}
                >
                  <span>{item.label}</span>
                  <span className="grid h-8 w-8 place-items-center rounded-xl text-lg text-[var(--theme-primary-text)]">
                    {item.icon}
                  </span>
                </Link>
              );
            })}
          </nav>
        </aside>

        <main className="min-w-0">
          <header className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-[var(--shadow-subtle)]">
            <div>
              <p className="text-xs font-bold text-slate-400">اقامتگاه فعال</p>
              <h1 className="mt-1 text-2xl font-black">{title}</h1>
              <p className="mt-1 text-sm font-semibold text-slate-500">
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
