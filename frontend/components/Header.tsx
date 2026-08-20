"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { KoochGuestAuthDialog } from "@/components/auth/KoochGuestAuthDialog";
import {
  type AuthWorkspace,
  useAuthSession,
} from "@/components/auth/AuthSessionProvider";
import { KoochUserMenu } from "@/components/KoochUserMenu";
import {
  defaultSiteSettings,
  fetchPublicSiteSettings,
  mergeSiteSettings,
  settingValue,
  SiteSettingsMap,
} from "@/lib/site-settings";
import { shouldBypassImageOptimization } from "@/lib/image-delivery";
import { KoochButton } from "./KoochButton";

const workspaceLabels: Record<AuthWorkspace, string> = {
  admin: "پنل مدیریت",
  owner: "پنل مالک",
  account: "حساب کاربری",
};

export function shouldShowDevelopmentNavigation(environment: string | undefined) {
  return environment === "development";
}

export function DevelopmentDatePickerNavigation({
  environment = process.env.NODE_ENV,
}: {
  environment?: string;
}) {
  if (!shouldShowDevelopmentNavigation(environment)) return null;

  return (
    <Link
      className="rounded-xl px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-100"
      href="/dev/date-picker-test"
    >
      تست تقویم
    </Link>
  );
}

export function Header() {
  const headerRef = useRef<HTMLElement>(null);
  const pathname = usePathname();
  const { authenticated: isLoggedIn, workspaces } = useAuthSession();
  const [settings, setSettings] =
    useState<SiteSettingsMap>(defaultSiteSettings);
  const routeWorkspace: AuthWorkspace | null = pathname.startsWith("/admin")
    ? "admin"
    : pathname.startsWith("/owner")
      ? "owner"
      : pathname.startsWith("/account")
        ? "account"
        : null;
  const workspace =
    routeWorkspace && workspaces.includes(routeWorkspace)
      ? routeWorkspace
      : null;

  useEffect(() => {
    fetchPublicSiteSettings()
      .then((items) => setSettings(mergeSiteSettings(items)))
      .catch(() => setSettings(defaultSiteSettings));
  }, []);

  useEffect(() => {
    const header = headerRef.current;
    if (!header) return;

    const publishHeight = () => {
      document.documentElement.style.setProperty(
        "--header-height",
        `${header.getBoundingClientRect().height}px`,
      );
    };

    publishHeight();
    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(publishHeight);
    observer?.observe(header);
    return () => {
      observer?.disconnect();
      document.documentElement.style.removeProperty("--header-height");
    };
  }, []);

  const siteName = settingValue(settings, "site.name");
  const logoUrl = settingValue(settings, "site.logoUrl");
  const [loginOpen, setLoginOpen] = useState(false);
  return (
    <header
      ref={headerRef}
      className="sticky top-0 z-50 border-b border-slate-200 bg-white/95 backdrop-blur-md"
    >
      <div className="mx-auto flex min-h-16 max-w-7xl flex-wrap items-center justify-between gap-3 px-5 py-3 sm:px-8">
        <div className="flex items-center gap-3">
          <Link
            aria-label="خانه کوچ"
            className="text-2xl font-black tracking-tight text-[var(--theme-primary-text)]"
            href="/"
          >
            {logoUrl ? (
              <Image
                alt={siteName}
                className="h-10 w-auto object-contain"
                height={40}
                priority
                sizes="160px"
                src={logoUrl}
                unoptimized={shouldBypassImageOptimization(logoUrl)}
                width={160}
              />
            ) : (
              siteName
            )}
          </Link>
          {workspace && (
            <span className="rounded-full bg-[var(--theme-primary-soft)] px-3 py-1 text-xs font-bold text-[var(--theme-primary-text)]">
              {workspaceLabels[workspace]}
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
          <DevelopmentDatePickerNavigation />
          <Link
            className="hidden rounded-xl px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 sm:block"
            href="/owner/properties/new"
          >
            میزبان شوید
          </Link>
          {isLoggedIn ? (
            <KoochUserMenu />
          ) : (
            <>
              <Link
                className="rounded-lg border border-[var(--theme-primary)] px-3 py-2 text-sm font-bold text-[var(--theme-primary-text)] transition hover:bg-[var(--theme-primary-soft)]"
                href="/login"
              >
                ورود
              </Link>
              <KoochButton onClick={() => setLoginOpen(true)}>
                ورود2
              </KoochButton>
            </>
          )}
        </nav>
        <KoochGuestAuthDialog open={loginOpen} onOpenChange={setLoginOpen} />
      </div>
    </header>
  );
}
