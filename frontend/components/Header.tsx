"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { clearToken, getToken, getWorkspace } from "@/lib/owner-api";
import {
  defaultSiteSettings,
  fetchPublicSiteSettings,
  mergeSiteSettings,
  settingValue,
  SiteSettingsMap,
} from "@/lib/site-settings";

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
  const [settings, setSettings] = useState<SiteSettingsMap>(defaultSiteSettings);

  useEffect(() => {
    setWorkspaceLabel(getWorkspace());
    setIsLoggedIn(Boolean(getToken()));
  }, [pathname]);

  useEffect(() => {
    fetchPublicSiteSettings()
      .then((items) => setSettings(mergeSiteSettings(items)))
      .catch(() => setSettings(defaultSiteSettings));
  }, []);

  function logout() {
    clearToken();
    setWorkspaceLabel(null);
    setIsLoggedIn(false);
    router.push("/login");
  }

  const siteName = settingValue(settings, "site.name");
  const logoUrl = settingValue(settings, "site.logoUrl");

  return (
    <header className="sticky top-0 z-50 border-b border-slate-200 bg-white/95 backdrop-blur-md">
      <div className="mx-auto flex min-h-16 max-w-7xl flex-wrap items-center justify-between gap-3 px-5 py-3 sm:px-8">
        <div className="flex items-center gap-3">
          <Link
            aria-label="خانه کوچ"
            className="text-2xl font-black tracking-tight text-[var(--theme-primary-text)]"
            href="/"
          >
            {logoUrl ? (
              <img alt={siteName} className="h-10 w-auto object-contain" src={logoUrl} />
            ) : (
              siteName
            )}
          </Link>
          {workspace && (
            <span className="rounded-full bg-[var(--theme-primary-soft)] px-3 py-1 text-xs font-bold text-[var(--theme-primary-text)]">
              {workspaceLabels[workspace] ?? "سایت مسافر"}
            </span>
          )}
        </div>
        <nav
          aria-label="ناوبری اصلی"
          className="flex flex-wrap items-center justify-end gap-1 sm:gap-3"
        >
          <Link
            className="rounded-xl px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-100"
            href="/properties"
          >
            اقامتگاه‌ها
          </Link>
          <Link
            className="hidden rounded-xl px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 sm:block"
            href="/owner/properties/new"
          >
            میزبان شوید
          </Link>
          {isLoggedIn && (
            <Link
              className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-bold text-slate-700 transition hover:border-[var(--theme-primary-border)] hover:text-[var(--theme-primary-text)]"
              href="/choose-workspace"
            >
              تغییر محیط کاربری
            </Link>
          )}
          {isLoggedIn ? (
            <button
              className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-bold text-slate-700 transition hover:border-red-200 hover:text-red-700"
              onClick={logout}
              type="button"
            >
              خروج
            </button>
          ) : (
            <Link
              className="rounded-xl border border-[var(--theme-primary)] px-3 py-2 text-sm font-bold text-[var(--theme-primary-text)] transition hover:bg-[var(--theme-primary-soft)]"
              href="/login"
            >
              ورود
            </Link>
          )}
        </nav>
      </div>
    </header>
  );
}
