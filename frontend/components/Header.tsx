"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { clearToken, getToken, getWorkspace } from "@/lib/owner-api";

const workspaceLabels: Record<string, string> = {
  admin: "پنل مدیریت",
  owner: "پنل مالک",
  traveler: "سایت مسافر",
};

export function Header() {
  const pathname = usePathname();
  const router = useRouter();
  const [workspace, setWorkspaceLabel] = useState<string | null>(null);
  const [isLoggedIn, setIsLoggedIn] = useState(false);

  useEffect(() => {
    setWorkspaceLabel(getWorkspace());
    setIsLoggedIn(Boolean(getToken()));
  }, [pathname]);

  function logout() {
    clearToken();
    setWorkspaceLabel(null);
    setIsLoggedIn(false);
    router.push("/login");
  }

  return (
    <header className="sticky top-0 z-50 border-b border-slate-200 bg-white/95 backdrop-blur-md">
      <div className="mx-auto flex min-h-16 max-w-7xl flex-wrap items-center justify-between gap-3 px-5 py-3 sm:px-8">
        <div className="flex items-center gap-3">
          <Link href="/" className="text-2xl font-black tracking-tight text-blue-700" aria-label="خانه کوچ">
            کوچ
          </Link>
          {workspace && <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-bold text-blue-700">{workspaceLabels[workspace] ?? "سایت مسافر"}</span>}
        </div>
        <nav className="flex flex-wrap items-center justify-end gap-1 sm:gap-3" aria-label="ناوبری اصلی">
          <Link href="/properties" className="rounded-lg px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-100">
            اقامتگاه‌ها
          </Link>
          <Link href="/owner/properties/new" className="hidden rounded-lg px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 sm:block">
            میزبان شوید
          </Link>
          {isLoggedIn && (
            <Link href="/choose-workspace" className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-bold text-slate-700 transition hover:border-blue-300 hover:text-blue-700">
              تغییر محیط کاربری
            </Link>
          )}
          {isLoggedIn ? (
            <button className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-bold text-slate-700 transition hover:border-red-200 hover:text-red-700" onClick={logout} type="button">
              خروج
            </button>
          ) : (
            <Link href="/login" className="rounded-lg border border-blue-600 px-3 py-2 text-sm font-bold text-blue-700 transition hover:bg-blue-50">
              ورود
            </Link>
          )}
        </nav>
      </div>
    </header>
  );
}
