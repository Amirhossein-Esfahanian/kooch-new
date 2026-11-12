import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { AccountReservation, PagedResult } from "@/lib/account-reservations";

const mocks = vi.hoisted(() => ({
  auth: { authenticated: true, loading: false, workspaces: ["account"], user: { userId: 9, fullName: "مینا احمدی", email: "mina@example.test" } },
  replace: vi.fn(), api: vi.fn(), reviews: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: mocks.replace }) }));
vi.mock("@/components/auth/AuthSessionProvider", () => ({ useAuthSession: () => mocks.auth, resolveSessionDestination: () => "/owner" }));
vi.mock("@/lib/owner-api", () => ({ apiRequest: mocks.api }));
vi.mock("@/lib/guest-reviews", () => ({ getEligibleReviewStays: mocks.reviews }));
import AccountPage from "@/app/account/page";
import { formatLocalIsoDate } from "@/lib/date-utils";

const paged = <T,>(items: T[], totalCount = items.length): PagedResult<T> => ({ items, totalCount, page: 1, pageSize: 1, totalPages: totalCount });
const stay = (overrides: Partial<AccountReservation> = {}): AccountReservation => ({
  reservationId: 1, reservationNumber: "R-1", propertyName: "خانه سرو", roomTypeName: "اتاق شاه‌نشین",
  checkInDate: "2026-11-16", checkOutDate: "2026-11-18", status: "Confirmed",
  nightsCount: 2, adults: 2, children: 0, roomCount: 1, totalPrice: 100, finalAmount: 100,
  paidAmount: 100, remainingAmount: 0, currency: "IRR", ...overrides,
});
let confirmed = paged([stay()], 50);
let paid = paged([stay({ reservationId: 2, reservationNumber: "R-2", propertyName: "سرای نزدیک", status: "Paid", checkInDate: "2026-11-14", checkOutDate: "2026-11-15" })], 3);
let unpaid = paged<AccountReservation>([]);
let wallet: unknown = { balance: 7000000, currency: "IRR" };
let failWallet = false;
const metric = (name: string) => screen.getByRole("link", { name }).closest("section")!;

beforeEach(() => {
  vi.clearAllMocks(); vi.setSystemTime(new Date("2026-11-12T10:00:00Z"));
  mocks.auth = { authenticated: true, loading: false, workspaces: ["account"], user: { userId: 9, fullName: "مینا احمدی", email: "mina@example.test" } };
  confirmed = paged([stay()], 50);
  paid = paged([stay({ reservationId: 2, reservationNumber: "R-2", propertyName: "سرای نزدیک", status: "Paid", checkInDate: "2026-11-14", checkOutDate: "2026-11-15" })], 3);
  unpaid = paged([]); wallet = { balance: 7000000, currency: "IRR" }; failWallet = false;
  mocks.reviews.mockResolvedValue(paged([]));
  mocks.api.mockImplementation(async (path: string) => {
    if (path === "/account/wallet?currency=IRR") { if (failWallet) throw new Error("private server diagnostic"); return wallet; }
    const query = new URLSearchParams(path.split("?")[1]);
    if (query.get("status") === "Confirmed") return confirmed;
    if (query.get("status") === "Paid") return paid;
    if (query.get("status") === "ApprovedAwaitingPayment") return unpaid;
    throw new Error("Unexpected request");
  });
});
afterEach(() => { vi.useRealTimers(); });

it("welcomes the real user and shows the nearest confirmed stay and authoritative totals, not page lengths", async () => {
  render(<AccountPage />);
  expect(screen.getByRole("heading", { name: "سلام، مینا احمدی" })).toBeTruthy();
  const next = screen.getByRole("region", { name: "اقامت بعدی شما" });
  expect(await within(next).findByRole("heading", { name: "سرای نزدیک" })).toBeTruthy();
  expect(within(next).queryByText("خانه سرو")).toBeNull();
  expect(within(next).getByRole("link", { name: "مشاهده جزئیات اقامت" }).getAttribute("href")).toBe("/account/reservations/R-2");
  expect(next.querySelector('time[datetime="2026-11-14"]')).toBeTruthy();
  expect(within(next).getByText("پرداخت شده")).toBeTruthy();
  expect(within(metric("مشاهده رزروهای من")).getByText("۵۳")).toBeTruthy();
  expect(await within(metric("مشاهده کیف پول")).findByText("۷٬۰۰۰٬۰۰۰")).toBeTruthy();
  expect(within(metric("مشاهده کیف پول")).getByText("IRR")).toBeTruthy();
  const requests = mocks.api.mock.calls.map(([path]) => String(path));
  const upcoming = requests.filter(path => /status=(Confirmed|Paid)/.test(path));
  expect(upcoming).toHaveLength(2);
  upcoming.forEach(path => {
    const params = new URLSearchParams(path.split("?")[1]);
    expect(params.get("checkInFrom")).toBe(formatLocalIsoDate(new Date()));
    expect(params.get("sort")).toBe("checkinasc"); expect(params.get("pageSize")).toBe("1");
  });
  expect(requests.some(path => path.includes("booking-sessions") || path.includes("activity"))).toBe(false);
});

it("shows an honest empty next-stay state, valid zero metrics and the existing Marketplace search link", async () => {
  confirmed = paged([]); paid = paged([]); wallet = { balance: 0, currency: "IRR" };
  render(<AccountPage />);
  expect(await screen.findByRole("link", { name: "جستجوی اقامتگاه" })).toHaveProperty("href", expect.stringContaining("/properties"));
  expect(within(metric("مشاهده رزروهای من")).getByText("۰")).toBeTruthy();
  expect(await within(metric("مشاهده کیف پول")).findByText("۰")).toBeTruthy();
  expect(await screen.findByText(/در موارد بررسی‌شده/)).toBeTruthy();
  expect(screen.queryByRole("heading", { name: /فعالیت اخیر/ })).toBeNull();
});

it("includes today's check-in using the existing local-date convention", async () => {
  const today = formatLocalIsoDate(new Date());
  confirmed = paged([stay({ checkInDate: today, checkOutDate: "2026-11-14" })], 1);
  render(<AccountPage />);
  const next = screen.getByRole("region", { name: "اقامت بعدی شما" });
  await within(next).findByRole("heading", { name: "خانه سرو" });
  expect(next.querySelector(`time[datetime="${today}"]`)).toBeTruthy();
});

it("does not claim a nearest stay or complete count when one confirmed-status query fails", async () => {
  const original = mocks.api.getMockImplementation()!;
  mocks.api.mockImplementation((path: string, init: RequestInit) => path.includes("status=Confirmed") ? Promise.reject(new Error("offline")) : original(path, init));
  render(<AccountPage />);
  const next = screen.getByRole("region", { name: "اقامت بعدی شما" });
  expect(await within(next).findByRole("alert")).toBeTruthy();
  expect(within(next).queryByText("سرای نزدیک")).toBeNull();
  expect(within(metric("مشاهده رزروهای من")).getByText("در دسترس نیست")).toBeTruthy();
});

it.each(["Cancelled", "Rejected", "Expired", "PaymentExpired", "Completed", "PendingApproval"])("never presents %s as a confirmed upcoming stay even if a response is inconsistent", async status => {
  confirmed = paged([stay({ status })]); paid = paged([]);
  render(<AccountPage />);
  const next = screen.getByRole("region", { name: "اقامت بعدی شما" });
  expect(await within(next).findByRole("alert")).toBeTruthy();
  expect(within(next).queryByRole("link", { name: "مشاهده جزئیات اقامت" })).toBeNull();
  expect(within(next).queryByRole("link", { name: "جستجوی اقامتگاه" })).toBeNull();
  expect(within(metric("مشاهده رزروهای من")).getByText("در دسترس نیست")).toBeTruthy();
});

it("does not display invalid or past dates as the next stay", async () => {
  confirmed = paged([stay({ checkInDate: "2026-11-01", checkOutDate: "2026-11-02" })]);
  render(<AccountPage />);
  expect(await within(screen.getByRole("region", { name: "اقامت بعدی شما" })).findByRole("alert")).toBeTruthy();
  expect(screen.queryByRole("link", { name: "مشاهده جزئیات اقامت" })).toBeNull();
});

it("keeps sections usable on partial failure and retries only the failed wallet without inventing a zero", async () => {
  failWallet = true; render(<AccountPage />);
  const walletCard = metric("مشاهده کیف پول");
  expect(await within(walletCard).findByRole("alert")).toBeTruthy();
  expect(within(walletCard).queryByText("۰")).toBeNull();
  expect(await screen.findByRole("heading", { name: "سرای نزدیک" })).toBeTruthy();
  expect(screen.queryByText("private server diagnostic")).toBeNull();
  failWallet = false; fireEvent.click(within(walletCard).getByRole("button", { name: "تلاش دوباره" }));
  await within(walletCard).findByText("۷٬۰۰۰٬۰۰۰");
  expect(mocks.api.mock.calls.filter(([path]) => String(path).includes("status=Confirmed"))).toHaveLength(1);
  expect(mocks.reviews).toHaveBeenCalledTimes(1);
});

it("treats missing financial fields as unavailable rather than a fabricated amount or currency", async () => {
  wallet = { currency: "IRR" }; render(<AccountPage />);
  expect(await within(metric("مشاهده کیف پول")).findByRole("alert")).toBeTruthy();
  expect(within(metric("مشاهده کیف پول")).queryByText("IRR")).toBeNull();
});

it("shows only verified payable reservations and new review actions, deduplicated by real reservation ID", async () => {
  const payable = stay({ reservationId: 30, reservationNumber: "R-PAY", status: "ApprovedAwaitingPayment", remainingAmount: 100,
    isPaymentEligible: true, paymentExpiresAtUtc: "2026-11-13T10:00:00Z" });
  unpaid = paged([payable, payable, { ...payable, reservationId: 31, paymentExpiresAtUtc: "2026-11-01T10:00:00Z" }, { ...payable, reservationId: 32, isPaymentEligible: false }]);
  const eligible = { reservationId: 37, reservationNumber: "R-37", propertyId: 2, propertyName: "سرای تجربه", checkOutDate: "2026-11-03",
    submissionDeadlineLocalDate: "2026-12-03", reviewId: null, revision: null };
  mocks.reviews.mockResolvedValue(paged([eligible, eligible, { ...eligible, reservationId: 38, reviewId: 4 }], 7));
  render(<AccountPage />);
  const attention = screen.getByRole("region", { name: "کارهای پیش رو" });
  const pay = await within(attention).findByRole("link", { name: "بررسی و پرداخت رزرو" });
  expect(pay.getAttribute("href")).toBe("/account/reservations/R-PAY");
  expect(within(attention).getAllByRole("link", { name: "ثبت نظر" })).toHaveLength(1);
  expect(within(attention).getByRole("link", { name: "ثبت نظر" }).getAttribute("href")).toBe("/account/reviews?reservationId=37");
  expect(within(metric("مشاهده نظرات من")).getByText("۷")).toBeTruthy();
});

it("renders independent accessible skeletons while resources are pending without artificial zero values", () => {
  mocks.api.mockReturnValue(new Promise(() => {})); mocks.reviews.mockReturnValue(new Promise(() => {}));
  render(<AccountPage />);
  expect(screen.getByRole("heading", { name: "سلام، مینا احمدی" })).toBeTruthy();
  screen.getAllByRole("status").forEach(status => expect(status.getAttribute("aria-busy")).toBe("true"));
  expect(screen.queryByText("۰")).toBeNull();
  expect(screen.queryByText("در دسترس نیست")).toBeNull();
});

it("keeps auth guards, makes no private requests before auth and cancels pending requests on logout", async () => {
  mocks.auth.authenticated = false;
  const view = render(<AccountPage />);
  expect(mocks.replace).toHaveBeenCalledWith("/login");
  expect(mocks.api).not.toHaveBeenCalled(); expect(mocks.reviews).not.toHaveBeenCalled();
  mocks.auth.authenticated = true; view.rerender(<AccountPage />);
  await screen.findByRole("heading", { name: "سرای نزدیک" });
  const signal = mocks.api.mock.calls[0][1].signal as AbortSignal;
  mocks.auth.authenticated = false; view.rerender(<AccountPage />);
  expect(signal.aborted).toBe(true); expect(screen.queryByText("سرای نزدیک")).toBeNull();
});

it("uses only the supplied SVGs and scoped responsive styling, keeping all existing account entry links", async () => {
  render(<AccountPage />);
  const assets = ["dashboard.svg", "reservations.svg", "reviews.svg", "wallet.svg"];
  assets.forEach(file => expect(existsSync(resolve("public/svgs/account", file))).toBe(true));
  expect(Array.from(document.querySelectorAll("img")).map(image => image.getAttribute("src"))).toEqual(assets.map(file => `/svgs/account/${file}`));
  expect(screen.getByRole("link", { name: "مشاهده رزروهای من" }).getAttribute("href")).toBe("/account/reservations");
  expect(screen.getByRole("link", { name: "مشاهده نظرات من" }).getAttribute("href")).toBe("/account/reviews");
  expect(screen.getByRole("link", { name: "مشاهده کیف پول" }).getAttribute("href")).toBe("/account/wallet");
  expect(screen.queryByRole("navigation")).toBeNull();
  expect(screen.getByRole("main").getAttribute("dir")).toBe("rtl");
  const css = readFileSync(resolve("components/account/AccountOverview.module.css"), "utf8");
  expect(css).toContain("grid-template-columns: repeat(3, minmax(0, 1fr))");
  expect(css).toContain("overflow-wrap: anywhere"); expect(css).toContain(":focus-visible");
  expect(css).not.toContain("100vw"); expect(css).not.toContain("animation:");
  await screen.findByRole("heading", { name: "سرای نزدیک" });
});
