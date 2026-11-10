import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
const route = vi.hoisted(() => ({ pathname: "/admin/reviews" as string | null }));
vi.mock("next/navigation", () => ({ usePathname: () => route.pathname }));
import { UnderlineTabs } from "@/components/UnderlineTabs";
import { ReviewModerationNavigation } from "@/components/reviews/ReviewModerationNavigation";
import styles from "@/components/UnderlineTabs.module.css";

beforeEach(() => { route.pathname = "/admin/reviews"; });

it("uses route-navigation links and exact active matching, never tab-panel roles", () => {
  render(<ReviewModerationNavigation />);
  const nav = screen.getByRole("navigation", { name: "صف‌های بررسی نظرات" });
  const links = within(nav).getAllByRole("link"); expect(links).toHaveLength(2);
  expect(links[0].textContent).toBe("نظرات مهمانان"); expect(links[0].getAttribute("href")).toBe("/admin/reviews");
  expect(links[1].textContent).toBe("پاسخ‌های اقامتگاه‌ها"); expect(links[1].getAttribute("href")).toBe("/admin/reviews/replies");
  expect(links[0].getAttribute("aria-current")).toBe("page"); expect(links[1].hasAttribute("aria-current")).toBe(false);
  expect(screen.queryByRole("tablist")).toBeNull(); expect(screen.queryByRole("tab")).toBeNull();
  links.forEach(link => { expect(link.hasAttribute("aria-selected")).toBe(false); expect(link.tabIndex).toBe(0); });
});

it("follows router changes in both directions and restores the active route on remount", () => {
  const view = render(<ReviewModerationNavigation />);
  route.pathname = "/admin/reviews/replies"; view.rerender(<ReviewModerationNavigation />);
  expect(screen.getByRole("link", { name: "پاسخ‌های اقامتگاه‌ها" }).getAttribute("aria-current")).toBe("page");
  expect(screen.getByRole("link", { name: "نظرات مهمانان" }).hasAttribute("aria-current")).toBe(false);
  route.pathname = "/admin/reviews"; view.rerender(<ReviewModerationNavigation />);
  expect(screen.getByRole("link", { name: "نظرات مهمانان" }).getAttribute("aria-current")).toBe("page");
  route.pathname = "/admin/reviews/replies"; view.unmount(); render(<ReviewModerationNavigation />);
  expect(screen.getByRole("link", { name: "پاسخ‌های اقامتگاه‌ها" }).getAttribute("aria-current")).toBe("page");
});

it("does not invent local selection on click and preserves native focusable anchors", () => {
  render(<ReviewModerationNavigation />);
  const reviews = screen.getByRole("link", { name: "نظرات مهمانان" });
  const replies = screen.getByRole("link", { name: "پاسخ‌های اقامتگاه‌ها" });
  replies.addEventListener("click", event => event.preventDefault());
  reviews.focus(); expect(document.activeElement).toBe(reviews); replies.focus(); expect(document.activeElement).toBe(replies);
  fireEvent.click(replies); expect(reviews.getAttribute("aria-current")).toBe("page"); expect(replies.hasAttribute("aria-current")).toBe(false);
});

it.each(["/admin/reviews/replies/", "/admin/reviews/other", null])("handles trailing slashes and unrelated/unresolved route %s", path => {
  route.pathname = path; render(<ReviewModerationNavigation />);
  const active = screen.getAllByRole("link").filter(link => link.getAttribute("aria-current") === "page");
  expect(active).toHaveLength(path === "/admin/reviews/replies/" ? 1 : 0);
});

it("supports reusable items, a root pathname and inherited RTL without hardcoded review routes", () => {
  route.pathname = "/";
  render(<div dir="rtl"><UnderlineTabs className="custom-navigation" ariaLabel="بخش‌ها" items={[{ href: "/", label: "خانه" }, { href: "/settings", label: "تنظیمات" }]} /></div>);
  const nav = screen.getByRole("navigation", { name: "بخش‌ها" }); expect(nav.classList.contains("custom-navigation")).toBe(true);
  expect(nav.classList.contains(styles.root)).toBe(true); expect(nav.getAttribute("dir")).toBeNull();
  expect(screen.getByRole("link", { name: "خانه" }).getAttribute("aria-current")).toBe("page");
});

it("scopes the three-pixel semantic underline, focus, mobile wrapping and reduced-motion treatment", () => {
  const css = readFileSync(resolve("components/UnderlineTabs.module.css"), "utf8");
  expect(css).toContain("height: 3px"); expect(css).toContain("background: var(--primary)");
  expect(css).toContain("inset-inline: 0"); expect(css).toContain("flex-wrap: wrap"); expect(css).toContain("min-height: 2.75rem");
  expect(css).toContain(":focus-visible"); expect(css).toContain("var(--ring)");
  expect(css).toContain("140ms ease-out"); expect(css).toContain("prefers-reduced-motion: reduce"); expect(css).toContain("transition: none");
  expect(css).not.toContain(":global");
});
