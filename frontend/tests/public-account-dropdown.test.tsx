import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const mocks = vi.hoisted(() => ({ pathname: "/properties", workspaces: ["account"], push: vi.fn(), clear: vi.fn() }));
vi.mock("next/navigation", () => ({ usePathname: () => mocks.pathname, useRouter: () => ({ push: mocks.push }) }));
vi.mock("@/components/auth/AuthSessionProvider", () => ({
  useAuthSession: () => ({ authenticated: true, workspaces: mocks.workspaces, user: { fullName: "مینا احمدی" }, clearSession: mocks.clear }),
  resolveSessionDestination: (_: unknown, workspace: string) => workspace === "owner" ? "/owner/properties/2" : `/${workspace}`,
}));
vi.mock("@/components/auth/UserProfileAvatarProvider", () => ({
  UserProfileAvatarProvider: ({ children }: { children: ReactNode }) => children,
  useUserProfileAvatar: () => ({ avatarUrl: null, clearAvatar: vi.fn() }),
}));
vi.mock("@/components/KoochUserProfileDialog", () => ({
  KoochUserProfileDialog: ({ open }: { open: boolean }) => open ? <div role="dialog" aria-label="تنظیمات حساب" /> : null,
}));
import { KoochUserMenu } from "@/components/KoochUserMenu";

beforeEach(() => { vi.clearAllMocks(); mocks.pathname = "/properties"; mocks.workspaces = ["account"]; });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function openMenu() {
  const trigger = screen.getByRole("button", { name: "منوی کاربر مینا احمدی" });
  fireEvent.click(trigger); return { trigger, menu: screen.getByRole("menu") };
}

it("uses all six exact public SVGs with real identity and the four links in the requested order", () => {
  render(<KoochUserMenu />); const { menu, trigger } = openMenu();
  expect(menu.getAttribute("dir")).toBe("rtl");
  expect(within(menu).getByText("مینا احمدی")).toBeTruthy();
  expect(trigger.textContent).toContain("م");
  const links = Array.from(menu.querySelectorAll("a[role=menuitem]"));
  expect(links.map(link => link.textContent)).toEqual(["حساب کاربری", "رزروهای من", "نظرات من", "کیف پول من"]);
  expect(links.map(link => link.getAttribute("href"))).toEqual(["/account", "/account/reservations", "/account/reviews", "/account/wallet"]);
  const assets = ["account.svg", "dashboard.svg", "reservations.svg", "reviews.svg", "wallet.svg", "logout.svg"];
  expect(Array.from(menu.querySelectorAll("img")).map(image => image.getAttribute("src"))).toEqual(assets.map(file => `/svgs/account/${file}`));
  assets.forEach(file => expect(existsSync(resolve("public/svgs/account", file))).toBe(true));
  menu.querySelectorAll("img").forEach(image => expect(image.alt).toBe(""));
  expect(within(menu).getByRole("separator").nextElementSibling?.textContent).toBe("خروج از حساب");
  expect(menu.querySelector('a[href="/account/orders"]')).toBeNull();
  expect(menu.querySelector('a[href*="settings"]')).toBeNull();
});

it.each([
  ["/account", "حساب کاربری"], ["/account/reservations", "رزروهای من"],
  ["/account/reservations/R-37", "رزروهای من"], ["/account/booking-sessions/BS-37", "رزروهای من"],
  ["/account/orders", "رزروهای من"], ["/account/reviews", "نظرات من"],
  ["/account/reviews/edit", "نظرات من"], ["/account/wallet", "کیف پول من"], ["/account/wallet/transactions", "کیف پول من"],
])("selects only the matching destination for pathname %s, independent of the orders-tab query", (pathname, label) => {
  mocks.pathname = pathname; render(<KoochUserMenu />); const { menu } = openMenu();
  const active = menu.querySelectorAll('[aria-current="page"]');
  expect(active).toHaveLength(1); expect(active[0].textContent).toBe(label);
});

it("does not accidentally match sibling prefixes or mark the account root on unrelated pages", () => {
  mocks.pathname = "/account/reviews-other"; render(<KoochUserMenu />);
  expect(openMenu().menu.querySelector('[aria-current="page"]')).toBeNull();
});

it("closes on client-side navigation without invoking logout", () => {
  render(<KoochUserMenu />); const { trigger, menu } = openMenu();
  const link = within(menu).getByRole("menuitem", { name: "رزروهای من" });
  // jsdom has no App Router; prevent only its native document navigation.
  link.addEventListener("click", event => event.preventDefault());
  fireEvent.click(link);
  expect(screen.queryByRole("menu")).toBeNull(); expect(document.activeElement).toBe(trigger);
  expect(mocks.clear).not.toHaveBeenCalled(); expect(mocks.push).not.toHaveBeenCalled();
});

it("preserves keyboard traversal, Escape/outside dismissal, focus restoration and real shared logout", () => {
  render(<KoochUserMenu />); const { trigger, menu } = openMenu();
  const items = within(menu).getAllByRole("menuitem");
  expect(document.activeElement).toBe(items[0]);
  fireEvent.keyDown(menu, { key: "ArrowDown" }); expect(document.activeElement).toBe(items[1]);
  fireEvent.keyDown(menu, { key: "End" }); expect(document.activeElement).toBe(items.at(-1));
  fireEvent.keyDown(menu, { key: "Home" }); expect(document.activeElement).toBe(items[0]);
  fireEvent.keyDown(menu, { key: "Escape" }); expect(screen.queryByRole("menu")).toBeNull();
  expect(document.activeElement).toBe(trigger);
  fireEvent.click(trigger); fireEvent.click(screen.getByRole("button", { name: "بستن منوی کاربر" }));
  expect(screen.queryByRole("menu")).toBeNull(); expect(document.activeElement).toBe(trigger);
  fireEvent.click(trigger); fireEvent.keyDown(screen.getByRole("menu"), { key: "Tab" });
  expect(screen.queryByRole("menu")).toBeNull();
  fireEvent.click(trigger); fireEvent.click(screen.getByRole("menuitem", { name: "خروج از حساب" }));
  expect(mocks.clear).toHaveBeenCalledOnce(); expect(mocks.push).toHaveBeenCalledWith("/login");
});

it("retains authorized role actions and the existing profile dialog without exposing restricted workspaces", () => {
  mocks.workspaces = ["account", "owner", "admin"];
  const view = render(<KoochUserMenu />); let { menu } = openMenu();
  expect(within(menu).getByRole("menuitem", { name: "پنل مدیریت" })).toBeTruthy();
  fireEvent.click(within(menu).getByRole("menuitem", { name: "پنل اقامتگاه‌ها" }));
  expect(mocks.push).toHaveBeenCalledWith("/owner/properties/2");
  fireEvent.click(screen.getByRole("button", { name: "منوی کاربر مینا احمدی" }));
  fireEvent.click(screen.getByRole("menuitem", { name: "تنظیمات حساب" }));
  expect(screen.getByRole("dialog", { name: "تنظیمات حساب" })).toBeTruthy();
  view.unmount(); mocks.workspaces = ["account"]; render(<KoochUserMenu />); menu = openMenu().menu;
  expect(within(menu).queryByRole("menuitem", { name: "پنل مدیریت" })).toBeNull();
  expect(within(menu).queryByRole("menuitem", { name: "پنل اقامتگاه‌ها" })).toBeNull();
});

it("clamps the public menu to mobile viewport bounds without changing its trigger", () => {
  vi.stubGlobal("innerWidth", 390);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function(this: HTMLElement) {
    return { left: 340, right: this.getAttribute("role") === "menu" ? 620 : 380, width: this.getAttribute("role") === "menu" ? 280 : 40, top: 10, bottom: 50, height: 40, x: 340, y: 10, toJSON() {} };
  });
  render(<KoochUserMenu />); const { menu, trigger } = openMenu();
  expect(menu.style.left).toBe("-242px");
  expect(trigger.style.left).toBe("");
  const css = readFileSync(resolve("components/KoochUserMenu.module.css"), "utf8");
  expect(css).toContain("width: 17.5rem"); expect(css).toContain("max-width: calc(100vw - 1.5rem)");
  expect(css).toContain("top: calc(100% + 0.5rem)"); expect(css).toContain("overflow-y: auto");
  expect(css).toContain("min-height: 2.75rem"); expect(css).toContain(":focus-visible");
  expect(css).toContain("prefers-reduced-motion");
  expect(css).toContain(".photo { display: block; border-radius: 50%; object-fit: cover; filter: none; }");
  expect(css).toContain(":global(.dark) .publicMenu .icon { filter: invert(1); }");
  expect(css).not.toMatch(/\.photo[^}]*invert\(/);
});

it("leaves the Property Direct menu separate from Marketplace links and SVGs", () => {
  render(<KoochUserMenu variant="property" propertySlug="stay" />);
  fireEvent.click(screen.getByRole("button", { name: "حساب من" }));
  const menu = screen.getByRole("menu"); expect(menu.querySelector("img")).toBeNull();
  expect(within(menu).queryByRole("menuitem", { name: "کیف پول من" })).toBeNull();
  fireEvent.click(within(menu).getByRole("menuitem", { name: "رزروهای من" }));
  expect(mocks.push).toHaveBeenCalledWith("/book/stay/my-bookings");
});
