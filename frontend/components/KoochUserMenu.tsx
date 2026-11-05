"use client";

import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  resolveSessionDestination,
  type AuthWorkspace,
  useAuthSession,
} from "@/components/auth/AuthSessionProvider";
import { KoochUserProfileDialog } from "@/components/KoochUserProfileDialog";
import { UserProfileAvatarProvider, useUserProfileAvatar } from "@/components/auth/UserProfileAvatarProvider";

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

export function KoochUserMenu(props: Parameters<typeof UserMenuContent>[0]) {
  return <UserProfileAvatarProvider eager={props.variant === "sidebar"}><UserMenuContent {...props} /></UserProfileAvatarProvider>;
}

function UserMenuContent({
  collapsed = false,
  darkMode = false,
  onOpenChange,
  open,
  variant = "public",
  propertySlug,
  onPropertyLogin,
  propertyLinks = [],
  propertyMenuLabel = "حساب من",
  triggerClassName = "",
  menuClassName = "",
}: {
  collapsed?: boolean;
  darkMode?: boolean;
  onOpenChange?: (open: boolean) => void;
  open?: boolean;
  variant?: "dashboard" | "public" | "sidebar" | "property";
  propertySlug?: string;
  onPropertyLogin?: () => void;
  propertyLinks?: ReadonlyArray<{ href: string; label: string }>;
  propertyMenuLabel?: string;
  triggerClassName?: string;
  menuClassName?: string;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const session = useAuthSession();
  const { avatarUrl, clearAvatar } = useUserProfileAvatar();
  const [internalOpen, setInternalOpen] = useState(false);
  const [profileDialogOpen, setProfileDialogOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const menuOpen = open ?? internalOpen;
  const isSidebar = variant === "sidebar";
  const isProperty = variant === "property";
  const currentWorkspace = routeWorkspace(pathname);
  const userName = session.user?.fullName || session.user?.email || "کاربر کوچ";
  const secondaryIdentifier = session.user?.email || session.user?.phoneNumber;
  const visibleWorkspaces = isProperty ? [] : workspaceOptions.filter((workspace) =>
    session.workspaces.includes(workspace.key),
  );

  const setMenuOpen = useCallback((nextOpen: boolean) => {
    if (open === undefined) setInternalOpen(nextOpen);
    onOpenChange?.(nextOpen);
  }, [onOpenChange, open]);

  useEffect(() => {
    if (!menuOpen || !(isSidebar || isProperty)) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (event.target instanceof Node && !menuRef.current?.contains(event.target) &&
        !triggerRef.current?.contains(event.target)) setMenuOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    return () => document.removeEventListener("pointerdown", closeOnOutsidePointer);
  }, [isSidebar, isProperty, menuOpen, setMenuOpen]);

  useEffect(() => {
    if (!menuOpen) return;

    const firstItem =
      menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]');
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
    router.push(isProperty && propertySlug ? `/book/${encodeURIComponent(propertySlug)}` : "/login");
  }

  function handleMenuKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const items = Array.from(
      menuRef.current?.querySelectorAll<HTMLElement>(
        '[role="menuitem"]',
      ) ?? [],
    );
    const currentIndex = items.indexOf(
      document.activeElement as HTMLElement,
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
    } else if (event.key === "Tab" && (isSidebar || isProperty)) {
      setMenuOpen(false);
      triggerRef.current?.focus();
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
    isSidebar
      ? "border-transparent bg-transparent text-foreground hover:bg-muted"
      : variant === "dashboard"
      ? dashboardTriggerClass
      : "border-border bg-background text-foreground hover:border-[var(--theme-primary-border)] hover:bg-muted";
  const menuClass = darkMode && !isSidebar
    ? "border-white/10 bg-[#111720] text-slate-100"
    : "border-border bg-popover text-popover-foreground";
  const itemClass = darkMode && !isSidebar ? "hover:bg-white/10" : "hover:bg-muted";

  return (
    <>
      <div className={isSidebar ? "relative w-full" : "relative"}>
        {menuOpen && !isSidebar && !isProperty && (
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
          aria-controls={menuOpen ? menuId : undefined}
          aria-label={isProperty ? propertyMenuLabel : `منوی کاربر ${userName}`}
          className={`relative z-[80] flex items-center gap-2 border px-2 py-1.5 text-sm font-bold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${isSidebar ? `min-h-11 w-full rounded-lg ${collapsed ? "md:justify-center" : ""}` : isProperty ? "min-h-11 max-w-56 rounded-lg" : "min-h-10 max-w-56 rounded-xl"} ${triggerClass} ${triggerClassName}`}
          onClick={() => setMenuOpen(!menuOpen)}
          ref={triggerRef}
          type="button"
          title={isSidebar && collapsed ? userName : undefined}
        >
          {!isProperty && <span className={`grid h-8 w-8 shrink-0 place-items-center overflow-hidden rounded-lg text-xs font-bold ${isSidebar ? "bg-primary text-primary-foreground" : "bg-[var(--theme-primary)] text-white"}`}>
            {isSidebar && avatarUrl ? (
              // Authenticated private media is rendered from the existing blob loader.
              // eslint-disable-next-line @next/next/no-img-element
              <img alt="تصویر پروفایل" className="h-full w-full object-cover" height={32} onError={clearAvatar} src={avatarUrl} width={32} />
            ) : userName.charAt(0)}
          </span>}
          {isSidebar ? (
            <span className={`min-w-0 flex-1 text-start ${collapsed ? "md:hidden" : ""}`}>
              <span className="block truncate text-sm font-semibold">{userName}</span>
              {secondaryIdentifier && secondaryIdentifier !== userName && (
                <span className="block truncate text-xs font-normal text-foreground" dir="auto">{secondaryIdentifier}</span>
              )}
            </span>
          ) : <span className={isProperty ? "min-w-0 truncate" : "hidden min-w-0 truncate lg:inline"}>{isProperty ? propertyMenuLabel : userName}</span>}
          <span aria-hidden="true" className={`text-muted-foreground ${isSidebar ? `rotate-180 ${collapsed ? "md:hidden" : ""}` : ""}`}>
            ▾
          </span>
        </button>

        {menuOpen && (
          <div
            aria-label={isProperty ? "حساب من" : "انتخاب محیط کاربری و حساب"}
            className={`absolute z-[90] w-64 border p-1 text-sm font-bold shadow-xl ${isSidebar ? "bottom-full right-0 mb-2 max-h-[calc(100dvh-6rem)] max-w-[calc(100vw-2rem)] overflow-y-auto rounded-lg" : "left-0 top-12 overflow-hidden rounded-xl"} ${menuClass} ${menuClassName}`}
            onKeyDown={handleMenuKeyDown}
            ref={menuRef}
            id={menuId}
            role="menu"
          >
            {isProperty && propertyLinks.map((link) => <a key={link.href} href={link.href} role="menuitem" className="flex min-h-11 items-center rounded-lg px-3 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => setMenuOpen(false)}>{link.label}</a>)}
            {isProperty && !session.authenticated && onPropertyLogin && <button className="block min-h-11 w-full rounded-lg px-3 py-2 text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" role="menuitem" type="button" onClick={() => { setMenuOpen(false); triggerRef.current?.focus(); onPropertyLogin(); }}>ورود / ثبت‌نام</button>}
            {isProperty && propertySlug && <button className={`block min-h-11 w-full rounded-lg px-3 py-2 text-right focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${itemClass}`} role="menuitem" type="button" onClick={() => { setMenuOpen(false); if (!session.authenticated && onPropertyLogin) { triggerRef.current?.focus(); onPropertyLogin(); } else router.push(`/book/${encodeURIComponent(propertySlug)}/my-bookings`); }}>رزروهای من</button>}
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
            {!isProperty && <><div className="my-1 border-t border-border" role="separator" />
            <button
              className={`block min-h-10 w-full rounded-lg px-3 py-2 text-right transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${itemClass}`}
              onClick={openAccountSettings}
              role="menuitem"
              type="button"
            >
              تنظیمات حساب
            </button>
            </>}
            {(!isProperty || session.authenticated) && <button
              className={`block ${isProperty ? "min-h-11" : "min-h-10"} w-full rounded-lg px-3 py-2 text-right text-destructive transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${itemClass}`}
              onClick={logout}
              role="menuitem"
              type="button"
            >
              {isProperty ? "خروج از حساب" : "خروج"}
            </button>}
          </div>
        )}
      </div>

      {!isProperty && <KoochUserProfileDialog
        onOpenChange={setProfileDialogOpen}
        open={profileDialogOpen}
      />}
    </>
  );
}
