"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  resolveSessionDestination,
  type AuthWorkspace,
  useAuthSession,
} from "@/components/auth/AuthSessionProvider";
import { KoochUserProfileDialog } from "@/components/KoochUserProfileDialog";

const workspaceOptions: ReadonlyArray<{
  key: AuthWorkspace;
  label: string;
}> = [
  { key: "account", label: "محیط مهمان" },
  { key: "owner", label: "پنل اقامتگاه‌ها" },
  { key: "admin", label: "پنل مدیریت" },
];

function routeWorkspace(pathname: string): AuthWorkspace | null {
  if (pathname.startsWith("/admin")) return "admin";
  if (pathname.startsWith("/owner")) return "owner";
  if (pathname.startsWith("/account")) return "account";
  return null;
}

export function KoochUserMenu({
  darkMode = false,
  onOpenChange,
  open,
  variant = "public",
}: {
  darkMode?: boolean;
  onOpenChange?: (open: boolean) => void;
  open?: boolean;
  variant?: "dashboard" | "public";
}) {
  const pathname = usePathname();
  const router = useRouter();
  const session = useAuthSession();
  const [internalOpen, setInternalOpen] = useState(false);
  const [profileDialogOpen, setProfileDialogOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuOpen = open ?? internalOpen;
  const currentWorkspace = routeWorkspace(pathname);
  const userName = session.user?.fullName || session.user?.email || "کاربر کوچ";
  const visibleWorkspaces = workspaceOptions.filter((workspace) =>
    session.workspaces.includes(workspace.key),
  );

  function setMenuOpen(nextOpen: boolean) {
    if (open === undefined) setInternalOpen(nextOpen);
    onOpenChange?.(nextOpen);
  }

  useEffect(() => {
    if (!menuOpen) return;

    const firstItem =
      menuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]');
    firstItem?.focus();
  }, [menuOpen]);

  function chooseWorkspace(workspace: AuthWorkspace) {
    setMenuOpen(false);
    router.push(resolveSessionDestination(session, workspace));
  }

  function openAccountSettings() {
    setMenuOpen(false);
    setProfileDialogOpen(true);
  }

  function logout() {
    setMenuOpen(false);
    session.clearSession();
    router.push("/login");
  }

  function handleMenuKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const items = Array.from(
      menuRef.current?.querySelectorAll<HTMLButtonElement>(
        '[role="menuitem"]',
      ) ?? [],
    );
    const currentIndex = items.indexOf(
      document.activeElement as HTMLButtonElement,
    );
    let nextIndex: number | null = null;

    if (event.key === "ArrowDown") {
      nextIndex = currentIndex < items.length - 1 ? currentIndex + 1 : 0;
    } else if (event.key === "ArrowUp") {
      nextIndex = currentIndex > 0 ? currentIndex - 1 : items.length - 1;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = items.length - 1;
    } else if (event.key === "Escape") {
      event.preventDefault();
      setMenuOpen(false);
      triggerRef.current?.focus();
      return;
    }

    if (nextIndex !== null && items[nextIndex]) {
      event.preventDefault();
      items[nextIndex].focus();
    }
  }

  const dashboardTriggerClass = darkMode
    ? "border-white/10 bg-white/5 text-slate-100 hover:border-[var(--theme-primary)]"
    : "border-slate-200 bg-slate-50 text-slate-900 hover:border-[var(--theme-primary)]";
  const triggerClass =
    variant === "dashboard"
      ? dashboardTriggerClass
      : "border-border bg-background text-foreground hover:border-[var(--theme-primary-border)] hover:bg-muted";
  const menuClass = darkMode
    ? "border-white/10 bg-[#111720] text-slate-100"
    : "border-border bg-popover text-popover-foreground";
  const itemClass = darkMode ? "hover:bg-white/10" : "hover:bg-muted";

  return (
    <>
      <div className="relative">
        {menuOpen && (
          <button
            aria-label="بستن منوی کاربر"
            className="fixed inset-0 z-[60] cursor-default"
            onClick={() => setMenuOpen(false)}
            type="button"
          />
        )}
        <button
          aria-expanded={menuOpen}
          aria-haspopup="menu"
          aria-label={`منوی کاربر ${userName}`}
          className={`relative z-[80] flex min-h-10 max-w-56 items-center gap-2 rounded-xl border px-2 py-1.5 text-sm font-bold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${triggerClass}`}
          onClick={() => setMenuOpen(!menuOpen)}
          ref={triggerRef}
          type="button"
        >
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-[var(--theme-primary)] text-xs font-bold text-white">
            {userName.charAt(0)}
          </span>
          <span className="hidden min-w-0 truncate lg:inline">{userName}</span>
          <span aria-hidden="true" className="text-muted-foreground">
            ▾
          </span>
        </button>

        {menuOpen && (
          <div
            aria-label="انتخاب محیط کاربری و حساب"
            className={`absolute left-0 top-12 z-[90] w-64 overflow-hidden rounded-xl border p-1 text-sm font-bold shadow-xl ${menuClass}`}
            onKeyDown={handleMenuKeyDown}
            ref={menuRef}
            role="menu"
          >
            {visibleWorkspaces.map((workspace) => (
              <button
                aria-current={
                  currentWorkspace === workspace.key ? "page" : undefined
                }
                className={`block min-h-10 w-full rounded-lg px-3 py-2 text-right transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${itemClass}`}
                key={workspace.key}
                onClick={() => chooseWorkspace(workspace.key)}
                role="menuitem"
                type="button"
              >
                {workspace.label}
              </button>
            ))}
            <div className="my-1 border-t border-border" role="separator" />
            <button
              className={`block min-h-10 w-full rounded-lg px-3 py-2 text-right transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${itemClass}`}
              onClick={openAccountSettings}
              role="menuitem"
              type="button"
            >
              تنظیمات حساب
            </button>
            <button
              className={`block min-h-10 w-full rounded-lg px-3 py-2 text-right text-destructive transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${itemClass}`}
              onClick={logout}
              role="menuitem"
              type="button"
            >
              خروج
            </button>
          </div>
        )}
      </div>

      <KoochUserProfileDialog
        onOpenChange={setProfileDialogOpen}
        open={profileDialogOpen}
      />
    </>
  );
}
