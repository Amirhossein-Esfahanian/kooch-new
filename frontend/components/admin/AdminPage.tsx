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
];

export function AdminPage({ title, children }: { title: string; children: ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="mx-auto grid max-w-7xl gap-6 px-5 py-8 sm:px-8 lg:grid-cols-[240px_minmax(0,1fr)]">
      <aside className="h-fit rounded-2xl border border-slate-200 bg-white p-4 shadow-sm lg:sticky lg:top-24">
        <p className="mb-4 text-sm font-black text-blue-700">پنل مدیریت</p>
        <nav className="grid gap-1">
          {links.map((link) => (
            <Link
              className={`rounded-lg px-3 py-2 text-sm font-bold ${pathname === link.href ? "bg-blue-50 text-blue-700" : "text-slate-700 hover:bg-slate-50"}`}
              href={link.href}
              key={link.label}
            >
              {link.label}
            </Link>
          ))}
        </nav>
      </aside>
      <section>
        <h1 className="mb-6 text-3xl font-black text-slate-950">{title}</h1>
        {children}
      </section>
    </div>
  );
}
