import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { GuestOrdersList } from "@/components/account/GuestOrdersList";
import { GuestReservationsList } from "@/components/account/GuestReservationsList";
import { formatDate, type AccountReservation } from "@/lib/account-reservations";

const mocks = vi.hoisted(() => ({
  session: { authenticated: true, loading: false, workspaces: ["account"] },
  orders: vi.fn(), reservations: vi.fn(),
}));
vi.mock("@/components/auth/AuthSessionProvider", () => ({ useAuthSession: () => mocks.session }));
vi.mock("@/lib/booking-sessions", () => ({ fetchAccountBookingSessions: mocks.orders }));
vi.mock("@/lib/owner-api", () => ({ apiRequest: mocks.reservations }));
vi.mock("@/lib/currency", () => ({ useSiteCurrencyLabel: () => "تومان", formatCurrency: (value: number) => String(value) }));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.session = { authenticated: true, loading: false, workspaces: ["account"] };
  mocks.orders.mockResolvedValue({ items: [], totalPages: 4 });
  mocks.reservations.mockResolvedValue({ items: [], totalPages: 4 });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

const reservation: AccountReservation = {
  reservationId: 37, reservationNumber: "R/37", propertyName: "سرای باغ", roomTypeName: "اتاق دو تخته", roomName: "اتاق انار",
  checkInDate: "2030-11-09", checkOutDate: "2030-11-10", nightsCount: 1, adults: 2, children: 0, roomCount: 1,
  totalPrice: 900, finalAmount: 800, paidAmount: 300, remainingAmount: 500, currency: "IRR", status: "Confirmed",
};

it.each(["orders", "reservations"] as const)("allows parent-controlled %s pagination without independently changing the parent's page", async kind => {
  const Component = kind === "orders" ? GuestOrdersList : GuestReservationsList;
  const api = mocks[kind]; const onPageChange = vi.fn();
  const view = render(<Component page={2} onPageChange={onPageChange} />);
  await waitFor(() => expect((screen.getByRole("button", { name: "بعدی" }) as HTMLButtonElement).disabled).toBe(false));
  const expectPage = (page: number) => kind === "orders"
    ? expect(api).toHaveBeenLastCalledWith(page, 10)
    : expect(api).toHaveBeenLastCalledWith(`/account/reservations?page=${page}&pageSize=10&sort=createddesc`);
  expectPage(2); expect(api).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: "بعدی" }));
  expect(onPageChange).toHaveBeenCalledWith(3); expect(api).toHaveBeenCalledTimes(1);
  view.rerender(<Component page={3} onPageChange={onPageChange} />);
  await waitFor(() => expect(api).toHaveBeenCalledTimes(2)); expectPage(3);
  view.unmount(); render(<Component page={3} onPageChange={onPageChange} />);
  await waitFor(() => expect(api).toHaveBeenCalledTimes(3)); expectPage(3);
  expect(screen.queryByRole("main")).toBeNull();
  expect(screen.queryByRole("heading", { name: /رزروهای من|سفارش‌های من/ })).toBeNull();
});

it("keeps separate parent page state when lists unmount and remount", async () => {
  function Parent() {
    const [showOrders, setShowOrders] = useState(false);
    const [reservationPage, setReservationPage] = useState(1);
    const [orderPage, setOrderPage] = useState(2);
    return <><button onClick={() => setShowOrders(value => !value)}>تعویض فهرست</button>
      {showOrders ? <GuestOrdersList page={orderPage} onPageChange={setOrderPage} />
        : <GuestReservationsList page={reservationPage} onPageChange={setReservationPage} />}</>;
  }
  render(<Parent />);
  await waitFor(() => expect((screen.getByRole("button", { name: "بعدی" }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole("button", { name: "بعدی" }));
  await waitFor(() => expect(mocks.reservations).toHaveBeenLastCalledWith("/account/reservations?page=2&pageSize=10&sort=createddesc"));
  fireEvent.click(screen.getByRole("button", { name: "تعویض فهرست" }));
  await waitFor(() => expect((screen.getByRole("button", { name: "بعدی" }) as HTMLButtonElement).disabled).toBe(false));
  expect(mocks.orders).toHaveBeenLastCalledWith(2, 10);
  fireEvent.click(screen.getByRole("button", { name: "بعدی" }));
  await waitFor(() => expect(mocks.orders).toHaveBeenLastCalledWith(3, 10));
  fireEvent.click(screen.getByRole("button", { name: "تعویض فهرست" }));
  await waitFor(() => expect(mocks.reservations).toHaveBeenCalledTimes(3));
  expect(mocks.reservations).toHaveBeenLastCalledWith("/account/reservations?page=2&pageSize=10&sort=createddesc");
  fireEvent.click(screen.getByRole("button", { name: "تعویض فهرست" }));
  await waitFor(() => expect(mocks.orders).toHaveBeenCalledTimes(3));
  expect(mocks.orders).toHaveBeenLastCalledWith(3, 10);
});

it.each(["anonymous", "loading", "wrong-workspace"])("does not fetch either list for %s authentication", condition => {
  mocks.session = { authenticated: condition !== "anonymous", loading: condition === "loading", workspaces: condition === "wrong-workspace" ? ["owner"] : ["account"] };
  render(<><GuestOrdersList /><GuestReservationsList /></>);
  expect(mocks.orders).not.toHaveBeenCalled(); expect(mocks.reservations).not.toHaveBeenCalled();
});

it.each(["orders", "reservations"] as const)("preserves %s provider error feedback", async kind => {
  mocks[kind].mockRejectedValue(new Error("خطای آزمایشی"));
  const Component = kind === "orders" ? GuestOrdersList : GuestReservationsList;
  render(<Component />);
  expect(await screen.findByText("خطای آزمایشی")).toBeTruthy();
});

it("retains every reservation detail and amount in a responsive card with the existing encoded destination", async () => {
  mocks.reservations.mockResolvedValue({ items: [reservation], totalPages: 1 });
  render(<GuestReservationsList />);
  const list = await screen.findByRole("region", { name: "فهرست رزروها" });
  expect(within(list).getByRole("heading", { name: "سرای باغ" })).toBeTruthy();
  for (const value of ["R/37", "اتاق انار", "تایید شده", "800", "500"]) expect(within(list).getByText(value)).toBeTruthy();
  expect(within(list).getByText("مبلغ کل (تومان)")).toBeTruthy();
  expect(within(list).getByText("باقی‌مانده (تومان)")).toBeTruthy();
  expect(list.querySelector('time[datetime="2030-11-09"]')?.textContent).toBe(formatDate(reservation.checkInDate));
  expect(list.querySelector('time[datetime="2030-11-10"]')).toBeTruthy();
  expect(within(list).getByRole("link", { name: "جزئیات" }).getAttribute("href")).toBe("/account/reservations/R%2F37");
  expect(within(list).queryByRole("link", { name: "پرداخت" })).toBeNull();
});

it("preserves room-type fallback, zero amounts and backend-authoritative payment eligibility", async () => {
  mocks.reservations.mockResolvedValue({ items: [{ ...reservation, roomName: null, finalAmount: 0, remainingAmount: 0, isPaymentEligible: true }], totalPages: 1 });
  render(<GuestReservationsList />);
  const list = await screen.findByRole("region", { name: "فهرست رزروها" });
  expect(within(list).getByText("اتاق دو تخته")).toBeTruthy();
  expect(within(list).getAllByText("0")).toHaveLength(2);
  expect(within(list).getByRole("link", { name: "پرداخت" }).getAttribute("href")).toBe("/account/reservations/R%2F37");
});

it("refreshes an expired reservation countdown once without changing its payment rules", async () => {
  mocks.reservations.mockResolvedValueOnce({ items: [{ ...reservation, status: "ApprovedAwaitingPayment", paymentExpiresAtUtc: "2000-01-01T12:00:00Z", remainingPaymentSeconds: 0, isPaymentEligible: false }], totalPages: 1 })
    .mockReturnValueOnce(new Promise(() => {}));
  render(<GuestReservationsList />);
  expect(await screen.findByText("مهلت گذشته")).toBeTruthy();
  await waitFor(() => expect(mocks.reservations).toHaveBeenCalledTimes(2));
  expect(screen.queryByRole("link", { name: "پرداخت" })).toBeNull();
});

it("keeps the real server-synchronized payment countdown ticking beside the existing payment action", async () => {
  vi.useFakeTimers();
  mocks.reservations.mockResolvedValue({ items: [{ ...reservation, status: "ApprovedAwaitingPayment", paymentExpiresAtUtc: "2099-01-01T12:00:00Z", remainingPaymentSeconds: 120, isPaymentEligible: true }], totalPages: 1 });
  render(<GuestReservationsList />);
  await act(async () => {});
  expect(screen.getByText("۰۲:۰۰")).toBeTruthy();
  expect(screen.getByText("مهلت پرداخت")).toBeTruthy();
  expect(screen.getByRole("link", { name: "پرداخت" }).getAttribute("href")).toBe("/account/reservations/R%2F37");
  act(() => { vi.advanceTimersByTime(1000); });
  expect(screen.getByText("۰۱:۵۹")).toBeTruthy();
  expect(mocks.reservations).toHaveBeenCalledTimes(1);
});

it.each(["orders", "reservations"] as const)("renders content-shaped %s skeletons only while actually loading", async kind => {
  let finish!: (value: { items: never[]; totalPages: number }) => void;
  mocks[kind].mockReturnValue(new Promise(resolve => { finish = resolve; }));
  const Component = kind === "orders" ? GuestOrdersList : GuestReservationsList;
  render(<Component />);
  const status = screen.getByRole("status");
  expect(status.getAttribute("aria-busy")).toBe("true");
  expect(status.querySelectorAll("a, button, header, aside, nav")).toHaveLength(0);
  expect(screen.queryByText(/هنوز/)).toBeNull();
  await act(async () => finish({ items: [], totalPages: 0 }));
  expect(screen.queryByRole("status")).toBeNull();
  expect(screen.getByRole("heading", { name: kind === "orders" ? "هنوز سفارشی ثبت نشده است" : "هنوز رزروی برای حساب شما ثبت نشده است." })).toBeTruthy();
});

it.each(["orders", "reservations"] as const)("keeps %s errors distinct from an empty list and supports a scoped retry", async kind => {
  mocks[kind].mockRejectedValueOnce(new Error("خطای آزمایشی"));
  const Component = kind === "orders" ? GuestOrdersList : GuestReservationsList;
  render(<Component />);
  expect(await screen.findByRole("alert")).toHaveProperty("textContent", expect.stringContaining("خطای آزمایشی"));
  expect(screen.queryByText(/هنوز/)).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "تلاش دوباره" }));
  await screen.findByRole("heading", { name: kind === "orders" ? "هنوز سفارشی ثبت نشده است" : "هنوز رزروی برای حساب شما ثبت نشده است." });
  expect(mocks[kind]).toHaveBeenCalledTimes(2);
});

it("retains loaded reservations and pagination if a later page request fails", async () => {
  mocks.reservations.mockResolvedValueOnce({ items: [reservation], totalPages: 2 }).mockRejectedValueOnce(new Error("صفحه دریافت نشد"));
  render(<GuestReservationsList />);
  await screen.findByRole("heading", { name: "سرای باغ" });
  fireEvent.click(screen.getByRole("button", { name: "بعدی" }));
  expect(await screen.findByRole("alert")).toHaveProperty("textContent", expect.stringContaining("صفحه دریافت نشد"));
  expect(screen.getByRole("heading", { name: "سرای باغ" })).toBeTruthy();
  expect(screen.getByRole("navigation", { name: "صفحه‌بندی رزروها" })).toBeTruthy();
});

it("keeps list styling scoped, token-based and mobile-safe while reusing reduced-motion skeletons", () => {
  const css = readFileSync(resolve("components/account/GuestBookingLists.module.css"), "utf8");
  expect(css).toContain("grid-template-columns: repeat(2, minmax(0, 1fr))");
  expect(css).toContain("grid-template-columns: repeat(4, minmax(0, 1fr))");
  expect(css).toContain("overflow-wrap: anywhere"); expect(css).toContain(":focus-visible");
  expect(css).toContain("min-height: 2.75rem"); expect(css).toContain("var(--card)");
  expect(css).not.toMatch(/#[\da-f]{3,8}\b|100vw|:global|box-shadow:/i);
  const skeletonCss = readFileSync(resolve("components/account/AccountSkeleton.module.css"), "utf8");
  expect(skeletonCss).toContain("prefers-reduced-motion: reduce");
  expect(skeletonCss).toContain("animation: none");
});
