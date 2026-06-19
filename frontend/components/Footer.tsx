"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ThemeSelector } from "@/components/ThemeSelector";
import {
  defaultSiteSettings,
  fetchPublicSiteSettings,
  mergeSiteSettings,
  settingValue,
  SiteSettingsMap,
} from "@/lib/site-settings";

export function Footer() {
  const [settings, setSettings] = useState<SiteSettingsMap>(defaultSiteSettings);

  useEffect(() => {
    fetchPublicSiteSettings()
      .then((items) => setSettings(mergeSiteSettings(items)))
      .catch(() => setSettings(defaultSiteSettings));
  }, []);

  const siteName = settingValue(settings, "site.name");
  const logoUrl = settingValue(settings, "site.logoUrl");

  return (
    <footer id="footer" className="border-t border-slate-200 bg-white text-slate-700">
      <div className="mx-auto grid max-w-7xl gap-8 px-5 py-10 sm:px-8 md:grid-cols-[1fr_auto] md:items-start">
        <div>
          <Link href="/" className="text-2xl font-black tracking-tight text-[var(--theme-primary-text)]">
            {logoUrl ? (
              <img alt={siteName} className="h-10 w-auto object-contain" src={logoUrl} />
            ) : (
              siteName
            )}
          </Link>
          <p className="mt-2 text-sm text-slate-500">
            {settingValue(settings, "site.footerText")}
          </p>
          <div className="mt-5 flex flex-wrap gap-6 text-sm font-semibold">
            <a href="#footer">درباره ما</a>
            <a href="mailto:hello@kooch.local">تماس</a>
            <Link href="/owner/properties/new">میزبان شوید</Link>
          </div>
        </div>
        <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-slate-50 p-4">
          <ThemeSelector compact />
        </div>
      </div>
      <div className="border-t border-slate-100 px-5 py-4 text-center text-xs text-slate-400">
        &copy; {new Date().getFullYear()} {siteName}
      </div>
    </footer>
  );
}
