import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import AccountLayout from "@/app/account/layout";
import AccountLoading from "@/app/account/loading";
import { AccountSkeleton } from "@/components/account/AccountSkeleton";
import { KoochPageHeader } from "@/components/KoochPageHeader";
import { PublicSiteShell } from "@/components/PublicSiteShell";

const navigation = vi.hoisted(() => ({ pathname: "/account" }));
vi.mock("next/navigation", () => ({ usePathname: () => navigation.pathname }));
vi.mock("@/components/auth/AuthSessionProvider", () => ({ useAuthSession: () => ({ user: undefined }) }));
vi.mock("@/components/Header", () => ({ Header: () => <header aria-label="هدر عمومی">Kooch</header> }));
vi.mock("@/components/Footer", () => ({ Footer: () => <footer>پاورقی عمومی</footer> }));
vi.mock("@/components/reviews/GuestReviewInvitation", () => ({ GuestReviewInvitation: () => null }));
beforeEach(() => { navigation.pathname = "/account"; });

it("provides the guest destinations and supplied gift SVG next to Wallet without inventing a profile route", () => {
  render(<AccountLayout><p>محتوای حساب</p></AccountLayout>);
  const nav = screen.getByRole("navigation", { name: "ناوبری محیط مهمان" });
  const links = within(nav).getAllByRole("link");
  expect(links.map(link => link.textContent)).toEqual(["نمای کلی", "رزروهای من", "نظرات من", "کیف پول", "هدایای من", "پروفایل من"]);
  expect(links.map(link => link.getAttribute("href"))).toEqual(["/account", "/account/reservations", "/account/reviews", "/account/wallet", "/account/welcome-gifts", "/account/profile"]);
  expect(screen.queryByRole("link", { name: "تنظیمات" })).toBeNull();
  const paths = ["account.svg", "dashboard.svg", "reservations.svg", "reviews.svg", "wallet.svg", "gift.svg", "account.svg"];
  expect(Array.from(screen.getByRole("complementary").querySelectorAll("img")).map(image => image.getAttribute("src")))
    .toEqual(paths.map(path => `/svgs/account/${path}`));
  paths.forEach(path => expect(existsSync(resolve("public/svgs/account", path))).toBe(true));
});

it.each([
  ["/account", "نمای کلی"], ["/account/", "نمای کلی"],
  ["/account/reservations", "رزروهای من"], ["/account/reservations/R-37/payment", "رزروهای من"],
  ["/account/orders", "رزروهای من"], ["/account/booking-sessions/BS-37", "رزروهای من"],
  ["/account/reviews", "نظرات من"], ["/account/reviews/edit", "نظرات من"],
  ["/account/wallet", "کیف پول"], ["/account/wallet/transactions", "کیف پول"],
  ["/account/welcome-gifts", "هدایای من"], ["/account/welcome-gifts/", "هدایای من"],
  ["/account/profile", "پروفایل من"], ["/account/profile/edit", "پروفایل من"],
])("highlights exactly one section for %s", (pathname, label) => {
  navigation.pathname = pathname;
  render(<AccountLayout><p>محتوا</p></AccountLayout>);
  const nav = screen.getByRole("navigation");
  const active = nav.querySelectorAll('[aria-current="page"]');
  expect(active).toHaveLength(1); expect(active[0].textContent).toBe(label);
});

it("does not match the account root or unrelated route prefixes and follows navigation without local selection state", () => {
  navigation.pathname = "/account/reviews-other";
  const view = render(<AccountLayout><p>محتوا</p></AccountLayout>);
  expect(screen.getByRole("navigation").querySelector("[aria-current]")).toBeNull();
  navigation.pathname = "/account/wallet";
  view.rerender(<AccountLayout><p>محتوا</p></AccountLayout>);
  expect(screen.getByRole("link", { name: "کیف پول" }).getAttribute("aria-current")).toBe("page");
});

it("keeps existing child headers and actions intact, with no second public header or main element added by the shell", () => {
  const onClick = vi.fn();
  const header = <KoochPageHeader title="عنوان فعلی" eyebrow="محیط مهمان" description="توضیحات فعلی" actions={<button onClick={onClick}>عملیات فعلی</button>} />;
  const reference = render(header); const original = reference.container.querySelector("header")!.outerHTML; reference.unmount();
  const view = render(<PublicSiteShell><AccountLayout><main>{header}<p>محتوای واقعی</p></main></AccountLayout></PublicSiteShell>);
  expect(screen.getAllByRole("banner", { name: "هدر عمومی" })).toHaveLength(1);
  const childHeader = screen.getByRole("heading", { name: "عنوان فعلی" }).closest("header")!;
  expect(childHeader.outerHTML).toBe(original);
  fireEvent.click(screen.getByRole("button", { name: "عملیات فعلی" })); expect(onClick).toHaveBeenCalledOnce();
  // The public shell and existing page already own main elements; AccountWorkspace adds none.
  expect(view.container.querySelectorAll("main")).toHaveLength(2);
  expect(screen.getAllByRole("complementary")).toHaveLength(1);
  expect(childHeader.closest('[dir="rtl"]')).toBeTruthy();
});

it("renders content-only route loading beneath one persistent navigation shell", () => {
  const view = render(<PublicSiteShell><AccountLayout><AccountLoading /></AccountLayout></PublicSiteShell>);
  expect(screen.getAllByRole("navigation")).toHaveLength(1);
  expect(screen.getAllByRole("banner")).toHaveLength(1);
  const loading = screen.getByRole("status");
  expect(loading.getAttribute("aria-busy")).toBe("true");
  expect(loading.textContent).toContain("در حال بارگذاری حساب کاربری");
  expect(within(loading).queryByRole("navigation")).toBeNull();
  expect(loading.querySelector("header")).toBeNull();
  expect(loading.querySelector("a, button, input")).toBeNull();
  const navigationNode = screen.getByRole("navigation");
  view.rerender(<PublicSiteShell><AccountLayout><p>محتوای آماده</p></AccountLayout></PublicSiteShell>);
  expect(screen.queryByRole("status")).toBeNull();
  expect(screen.getByRole("navigation")).toBe(navigationNode);
});

it("allows skeleton composition without timers, duplicate status announcements or fake data", () => {
  const view = render(<><AccountSkeleton className="custom-width" /><AccountSkeleton variant="block" /></>);
  expect(view.container.children).toHaveLength(2);
  Array.from(view.container.children).forEach(child => expect(child.getAttribute("aria-hidden")).toBe("true"));
  expect(view.container.firstElementChild?.className).toContain("custom-width");
  expect(screen.queryByRole("status")).toBeNull();
  expect(view.container.textContent).toBe("");
});

it("uses a right-side desktop grid, mobile navigation above content and scoped theme/focus/reduced-motion styles", () => {
  render(<AccountLayout><p>محتوا</p></AccountLayout>);
  const sidebar = screen.getByRole("complementary");
  expect(sidebar.parentElement?.getAttribute("dir")).toBe("rtl");
  expect(sidebar.parentElement?.firstElementChild).toBe(sidebar);
  const css = readFileSync(resolve("components/account/AccountWorkspace.module.css"), "utf8");
  expect(css).toContain("grid-template-columns: 14.5rem minmax(0, 1fr)");
  expect(css).toContain("@media (min-width: 1024px)");
  expect(css).toContain("position: sticky"); expect(css).toContain("var(--header-height, 5rem)");
  expect(css).toContain("grid-template-columns: repeat(2, minmax(0, 1fr))");
  expect(css).toContain("min-height: 2.75rem"); expect(css).toContain(":focus-visible");
  expect(css).toContain("var(--card)"); expect(css).not.toContain("100vw");
  const skeletonCss = readFileSync(resolve("components/account/AccountSkeleton.module.css"), "utf8");
  expect(skeletonCss).toContain("prefers-reduced-motion: reduce");
  expect(skeletonCss).toContain("animation: none");
});
