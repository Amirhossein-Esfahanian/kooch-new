import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ApiRequestError } from "@/lib/owner-api";
import { formatDateTime } from "@/lib/account-reservations";
import type { WelcomeGift } from "@/lib/account-welcome-gifts";
import WelcomeGiftsPage, { metadata } from "@/app/account/welcome-gifts/page";

const mocks = vi.hoisted(() => ({
  api: vi.fn(), replace: vi.fn(),
  session: { authenticated: true, loading: false, workspaces: ["account"], user: { userId: 9 } },
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: mocks.replace }) }));
vi.mock("@/components/auth/AuthSessionProvider", () => ({ useAuthSession: () => mocks.session, resolveSessionDestination: () => "/owner" }));
vi.mock("@/lib/owner-api", async original => ({ ...await original<typeof import("@/lib/owner-api")>(), apiRequest: mocks.api }));

const gift: WelcomeGift = { title: "هدیهٔ خوشامدگویی", grantedAmount: 1250000, currency: "IRR", grantedAtUtc: "2020-01-01T10:00:00Z", expiresAtUtc: "2020-01-31T10:00:00Z" };
const history = (items: WelcomeGift[], page = 1, totalCount = items.length) => ({ items, page, pageSize: 20, totalCount, totalPages: Math.ceil(totalCount / 20) });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.session = { authenticated: true, loading: false, workspaces: ["account"], user: { userId: 9 } };
  mocks.api.mockResolvedValue(history([gift]));
});
afterEach(() => { vi.useRealTimers(); });

it("shows original amounts, actual API currencies and dates without claiming remaining balance or spendability", async () => {
  mocks.api.mockResolvedValue(history([gift, { ...gift, title: "هدیه دوم", currency: "EUR", grantedAmount: 25, expiresAtUtc: "2099-01-01T10:00:00Z" }]));
  render(<WelcomeGiftsPage />);
  const cards = await screen.findAllByRole("listitem");
  expect(within(cards[0]).getByText("مبلغ اولیه هدیه")).toBeTruthy();
  expect(within(cards[0]).getByText("۱٬۲۵۰٬۰۰۰", { exact: false })).toBeTruthy();
  expect(within(cards[0]).getByText("IRR").getAttribute("dir")).toBe("ltr");
  expect(within(cards[1]).getByText("EUR")).toBeTruthy();
  expect(within(cards[0]).getByText("منقضی‌شده")).toBeTruthy();
  expect(within(cards[1]).queryByText("منقضی‌شده")).toBeNull();
  expect(screen.queryByText(/قابل مصرف|قابل‌مصرف|قابل استفاده$/, { exact: true })).toBeNull();
  expect(cards[0].querySelector(`time[datetime="${gift.grantedAtUtc}"]`)?.textContent).toBe(formatDateTime(gift.grantedAtUtc));
  expect(cards[0].querySelector(`time[datetime="${gift.expiresAtUtc}"]`)).toBeTruthy();
  expect(screen.getByRole("main").getAttribute("dir")).toBe("rtl");
  expect(metadata?.robots).toEqual({ index: false, follow: false });
  expect(screen.queryByRole("link")).toBeNull();
});

it("uses one bounded server page through the existing client without prefetching all grants", async () => {
  mocks.api.mockResolvedValueOnce(history([gift], 1, 21)).mockResolvedValueOnce(history([{ ...gift, title: "هدیه صفحه دوم" }], 2, 21)).mockResolvedValue(history([gift], 1, 21));
  render(<WelcomeGiftsPage />);
  await screen.findByRole("list");
  expect(mocks.api).toHaveBeenCalledOnce();
  expect(mocks.api).toHaveBeenLastCalledWith("/account/welcome-gifts?page=1&pageSize=20", { signal: expect.any(AbortSignal), cache: "no-store" });
  expect((screen.getByRole("button", { name: "قبلی" }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "بعدی" }));
  await screen.findByRole("heading", { name: "هدیه صفحه دوم" });
  expect(mocks.api).toHaveBeenLastCalledWith("/account/welcome-gifts?page=2&pageSize=20", expect.anything());
  expect((screen.getByRole("button", { name: "بعدی" }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "قبلی" }));
  await screen.findByRole("heading", { name: gift.title });
  expect(mocks.api).toHaveBeenCalledTimes(3);
});

it("shows content-only skeletons during real loading and a distinct empty history after resolution", async () => {
  let finish!: () => void;
  mocks.api.mockReturnValue(new Promise(resolve => { finish = () => resolve(history([])); }));
  render(<WelcomeGiftsPage />);
  const loading = screen.getByRole("status");
  expect(loading.getAttribute("aria-busy")).toBe("true");
  expect(loading.querySelectorAll("a, button, nav, aside, header")).toHaveLength(0);
  expect(screen.queryByText("هنوز هدیه‌ای برای شما ثبت نشده است")).toBeNull();
  await act(async () => finish());
  expect(screen.queryByRole("status")).toBeNull();
  expect(screen.getByRole("heading", { name: "هنوز هدیه‌ای برای شما ثبت نشده است" })).toBeTruthy();
  expect(screen.queryByRole("list")).toBeNull();
});

it.each([404, 503, 500])("keeps HTTP %s distinct from empty history and retries without exposing server errors", async status => {
  mocks.api.mockRejectedValueOnce(new ApiRequestError("private diagnostic", status)).mockResolvedValue(history([gift]));
  render(<WelcomeGiftsPage />);
  const error = await screen.findByRole("alert");
  expect(error.textContent).toMatch(/دسترس نیست|انجام نشد/);
  expect(screen.queryByText("هنوز هدیه‌ای برای شما ثبت نشده است")).toBeNull();
  expect(screen.queryByText("private diagnostic")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "تلاش دوباره" }));
  await screen.findByRole("heading", { name: gift.title });
  expect(mocks.api).toHaveBeenCalledTimes(2);
});

it.each([{ items: [] }, history([{ ...gift, currency: "" }]), history([{ ...gift, grantedAmount: undefined } as unknown as WelcomeGift])])("does not treat malformed data as empty history or invent a currency/amount", async value => {
  mocks.api.mockResolvedValue(value);
  render(<WelcomeGiftsPage />);
  expect(await screen.findByRole("alert")).toBeTruthy();
  expect(screen.queryByRole("list")).toBeNull();
  expect(screen.queryByText("هنوز هدیه‌ای برای شما ثبت نشده است")).toBeNull();
});

it("provides reauthentication for a failed session", async () => {
  mocks.api.mockRejectedValue(new ApiRequestError("expired", 401));
  render(<WelcomeGiftsPage />);
  expect((await screen.findByRole("link", { name: "ورود دوباره" })).getAttribute("href")).toBe("/login?returnTo=%2Faccount%2Fwelcome-gifts");
});

it.each(["anonymous", "loading", "wrong-workspace"])("never requests private history for %s authentication", condition => {
  mocks.session = { ...mocks.session, authenticated: condition !== "anonymous", loading: condition === "loading", workspaces: condition === "wrong-workspace" ? ["owner"] : ["account"] };
  render(<WelcomeGiftsPage />);
  expect(mocks.api).not.toHaveBeenCalled();
  if (condition !== "loading") expect(mocks.replace).toHaveBeenCalledWith(condition === "anonymous" ? "/login?returnTo=%2Faccount%2Fwelcome-gifts" : "/owner");
});

it("aborts pending history and removes private content when the shared session logs out", async () => {
  const view = render(<WelcomeGiftsPage />);
  await screen.findByRole("heading", { name: gift.title });
  const signal = mocks.api.mock.calls[0][1].signal as AbortSignal;
  mocks.session.authenticated = false;
  view.rerender(<WelcomeGiftsPage />);
  expect(signal.aborted).toBe(true);
  expect(screen.queryByRole("list")).toBeNull();
});

it("updates expiry labels locally without issuing another history request", async () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-13T10:00:00Z"));
  mocks.api.mockResolvedValue(history([{ ...gift, expiresAtUtc: "2026-11-13T10:00:01Z" }]));
  render(<WelcomeGiftsPage />); await act(async () => {});
  expect(screen.queryByText("منقضی‌شده")).toBeNull();
  act(() => { vi.advanceTimersByTime(1000); });
  expect(screen.getByText("منقضی‌شده")).toBeTruthy();
  expect(mocks.api).toHaveBeenCalledOnce();
});

it("keeps layout styles scoped and responsive and reuses reduced-motion skeletons", () => {
  const css = readFileSync(resolve("components/account/GuestWelcomeGiftsPage.module.css"), "utf8");
  expect(css).toContain("min-width: 0"); expect(css).toContain("overflow-wrap: anywhere");
  expect(css).toContain(":focus-visible"); expect(css).toContain("var(--card)");
  expect(css).not.toMatch(/#[\da-f]{3,8}\b|100vw|:global|animation:|box-shadow:/i);
  const skeletonCss = readFileSync(resolve("components/account/AccountSkeleton.module.css"), "utf8");
  expect(skeletonCss).toContain("prefers-reduced-motion: reduce");
  expect(skeletonCss).toContain("animation: none");
});
