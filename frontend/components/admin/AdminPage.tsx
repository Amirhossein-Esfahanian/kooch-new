"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ReactNode } from "react";

const links = [
  { href: "/admin", label: "داشبورد" },
  { href: "/admin/properties", label: "مدیریت اقامتگاه‌ها" },
  { href: "/admin/users", label: "مدیریت کاربران" },
  { href: "/owner/amenities", label: "مدیریت امکانات" },
  { href: "/admin#reports", label: "گزارش‌ها" },
  { href: "/admin/settings", label: "تنظیمات" },
];

export function AdminPage({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  const pathname = usePathname();

  return (
    <div className="mx-auto grid max-w-7xl gap-7 px-5 py-8 sm:px-8 lg:grid-cols-[250px_minmax(0,1fr)]">
      <aside className="h-fit rounded-2xl border border-slate-200 bg-white p-4 shadow-[var(--shadow-subtle)] lg:sticky lg:top-24">
        <p className="mb-4 text-sm font-black text-[var(--theme-primary-text)]">
          پنل مدیریت
        </p>
        <nav className="grid gap-1">
          {links.map((link) => {
            const active = pathname === link.href;
            return (
              <Link
                className={`rounded-2xl px-4 py-3 text-sm font-bold transition ${
                  active
                    ? "bg-[var(--theme-primary-soft)] text-[var(--theme-primary-text)]"
                    : "text-slate-700 hover:bg-slate-50"
                }`}
                href={link.href}
                key={link.label}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>
      </aside>
      <section className="min-w-0">
        <div className="mb-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-[var(--shadow-subtle)]">
          <h1 className="text-3xl font-black text-slate-950">{title}</h1>
        </div>
        {children}
      </section>
    </div>
  );
}
