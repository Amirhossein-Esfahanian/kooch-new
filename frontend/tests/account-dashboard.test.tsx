import { render, screen, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const auth = vi.hoisted(() => ({ session: { authenticated: true, loading: false, workspaces: ["account"] }, replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: auth.replace }) }));
vi.mock("@/components/auth/AuthSessionProvider", () => ({ useAuthSession: () => auth.session, resolveSessionDestination: () => "/owner" }));
import AccountPage from "@/app/account/page";
import { KoochPageHeader } from "@/components/KoochPageHeader";

beforeEach(() => {
  auth.session = { authenticated: true, loading: false, workspaces: ["account"] };
  auth.replace.mockClear();
});

it("preserves the exact existing top header", () => {
  const reference = render(<KoochPageHeader description="رزروهای ثبت‌شده با حساب کاربری خود را مشاهده و پیگیری کنید." eyebrow="محیط مهمان" title="حساب کاربری" />);
  const expected = reference.container.querySelector("header")!.outerHTML;
  reference.unmount(); render(<AccountPage />);
  const header = screen.getByRole("heading", { name: "حساب کاربری" }).closest("header")!;
  expect(header.outerHTML).toBe(expected);
  expect(header.parentElement?.firstElementChild).toBe(header);
});

it("makes each whole compact card a single link to a working existing destination", () => {
  render(<AccountPage />);
  const navigation = screen.getByRole("navigation", { name: "بخش‌های حساب کاربری" });
  const links = within(navigation).getAllByRole("link");
  expect(links.map(link => link.getAttribute("href"))).toEqual(["/account/reservations", "/account/orders", "/account/reviews", "/account/wallet"]);
  links.forEach(link => {
    expect(within(link).getByRole("heading", { level: 2 })).toBeTruthy();
    expect(link.querySelectorAll("button, a, input, [tabindex]")).toHaveLength(0);
    expect(link.firstElementChild?.tagName).toBe("SECTION");
  });
  expect(navigation.closest("main")?.getAttribute("dir")).toBe("rtl");
  expect(screen.queryByRole("link", { name: /تنظیمات/ })).toBeNull();
});

it("uses the exact supplied public SVG paths without replacing assets or inventing settings", () => {
  for (const file of ["reservations.svg", "reviews.svg", "wallet.svg", "settings.svg"]) {
    expect(existsSync(resolve("public/svgs/account", file))).toBe(true);
  }
  render(<AccountPage />);
  const nav = screen.getByRole("navigation", { name: "بخش‌های حساب کاربری" });
  const images = Array.from(nav.querySelectorAll("img"));
  expect(images.map(image => image.getAttribute("src"))).toEqual(["/svgs/account/reservations.svg", "/svgs/account/reservations.svg", "/svgs/account/reviews.svg", "/svgs/account/wallet.svg"]);
  images.forEach(image => { expect(image.alt).toBe(""); expect(image.getAttribute("width")).toBe("40"); });
});

it("scopes responsive, theme, focus and reduced-motion styles to the dashboard", () => {
  const css = readFileSync(resolve("app/account/page.module.css"), "utf8");
  expect(css).toContain("grid-template-columns: minmax(0, 1fr)");
  expect(css).toContain("grid-template-columns: repeat(2, minmax(0, 1fr))");
  expect(css).toContain(".link:focus-visible"); expect(css).toContain("var(--ring)");
  expect(css).toContain(":global(.dark) .icon");
  expect(css).toContain("prefers-reduced-motion: reduce");
  expect(css).not.toContain("100vw");
});

it("keeps the existing authentication guard and hides private navigation for anonymous guests", () => {
  auth.session.authenticated = false;
  render(<AccountPage />);
  expect(auth.replace).toHaveBeenCalledWith("/login");
  expect(screen.queryByRole("navigation")).toBeNull();
});
