import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useSyncExternalStore } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const mocks = vi.hoisted(() => ({
  query: "", listeners: new Set<() => void>(), push: vi.fn(), replace: vi.fn(),
  session: { authenticated: true, loading: false, workspaces: ["account"] },
  reservations: vi.fn(), orders: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push, replace: mocks.replace }),
  useSearchParams: () => new URLSearchParams(useSyncExternalStore(
    listener => { mocks.listeners.add(listener); return () => { mocks.listeners.delete(listener); }; },
    () => mocks.query, () => mocks.query,
  )),
}));
vi.mock("@/components/auth/AuthSessionProvider", () => ({ useAuthSession: () => mocks.session, resolveSessionDestination: () => "/owner" }));
vi.mock("@/lib/booking-sessions", () => ({ fetchAccountBookingSessions: mocks.orders }));
vi.mock("@/lib/owner-api", () => ({ apiRequest: mocks.reservations }));
vi.mock("@/lib/currency", () => ({ useSiteCurrencyLabel: () => "تومان", formatCurrency: (value: number) => String(value) }));
import AccountReservationsPage from "@/app/account/reservations/page";

function navigate(query: string) { mocks.query = query; mocks.listeners.forEach(listener => listener()); }
const reservationTab = () => screen.getByRole("tab", { name: "رزروهای مستقل" });
const orderTab = () => screen.getByRole("tab", { name: "سفارش‌های چنداقامتگاهی" });
const nextEnabled = async () => waitFor(() => expect((screen.getByRole("button", { name: "بعدی" }) as HTMLButtonElement).disabled).toBe(false));

beforeEach(() => {
  vi.clearAllMocks(); mocks.query = "";
  mocks.session = { authenticated: true, loading: false, workspaces: ["account"] };
  mocks.push.mockImplementation((href: string) => navigate(href.split("?")[1] ?? ""));
  mocks.reservations.mockResolvedValue({ items: [], totalPages: 4 });
  mocks.orders.mockResolvedValue({ items: [], totalPages: 4 });
});

it.each(["", "tab=reservations", "tab=invalid"])("defaults safely to standalone reservations for query %s", async query => {
  mocks.query = query; render(<AccountReservationsPage />);
  expect(reservationTab().getAttribute("aria-selected")).toBe("true");
  await waitFor(() => expect(mocks.reservations).toHaveBeenCalledOnce());
  expect(mocks.orders).not.toHaveBeenCalled(); expect(mocks.push).not.toHaveBeenCalled();
  expect(screen.getAllByRole("tabpanel")).toHaveLength(1);
});

it("preserves the exact header node and unrelated queries while switching only the mounted panel without scrolling", async () => {
  mocks.query = "source=mail&source=guest";
  render(<AccountReservationsPage />); await nextEnabled();
  const header = screen.getByRole("heading", { name: "رزروهای من" }).closest("header")!;
  const original = header.outerHTML;
  expect(within(header).getByRole("link", { name: "بازگشت به حساب کاربری" }).getAttribute("href")).toBe("/account");
  fireEvent.click(orderTab());
  expect(mocks.push).toHaveBeenCalledWith("/account/reservations?source=mail&source=guest&tab=orders", { scroll: false });
  await waitFor(() => expect(mocks.orders).toHaveBeenCalledOnce());
  expect(screen.getByRole("heading", { name: "رزروهای من" }).closest("header")).toBe(header);
  expect(header.outerHTML).toBe(original);
  expect(screen.queryByRole("table")).toBeNull();
  expect(screen.getAllByRole("tabpanel")).toHaveLength(1);
  const panel = screen.getByRole("tabpanel");
  expect(panel.id).toBe(orderTab().getAttribute("aria-controls"));
  expect(panel.getAttribute("aria-labelledby")).toBe(orderTab().id);
  expect(mocks.reservations).toHaveBeenCalledOnce();
});

it("reads deep links on refresh and responds to simulated browser Back/Forward without creating extra history entries", async () => {
  mocks.query = "tab=orders";
  const view = render(<AccountReservationsPage />); await nextEnabled();
  expect(orderTab().getAttribute("aria-selected")).toBe("true");
  expect(mocks.reservations).not.toHaveBeenCalled();
  act(() => navigate("tab=reservations"));
  await waitFor(() => expect(mocks.reservations).toHaveBeenCalledOnce());
  expect(reservationTab().getAttribute("aria-selected")).toBe("true");
  act(() => navigate("tab=orders"));
  await waitFor(() => expect(mocks.orders).toHaveBeenCalledTimes(2));
  expect(orderTab().getAttribute("aria-selected")).toBe("true");
  expect(mocks.push).not.toHaveBeenCalled();
  view.unmount(); render(<AccountReservationsPage />);
  await waitFor(() => expect(mocks.orders).toHaveBeenCalledTimes(3));
  expect(orderTab().getAttribute("aria-selected")).toBe("true");
});

it("supports manual RTL roving focus, Home/End and explicit Enter/Space activation", async () => {
  render(<AccountReservationsPage />); await nextEnabled();
  const first = reservationTab(); const second = orderTab();
  first.style.direction = "rtl"; second.style.direction = "rtl";
  first.focus(); fireEvent.keyDown(first, { key: "ArrowLeft" });
  expect(document.activeElement).toBe(second); expect(second.tabIndex).toBe(0); expect(first.tabIndex).toBe(-1);
  expect(first.getAttribute("aria-selected")).toBe("true");
  expect(mocks.orders).not.toHaveBeenCalled(); expect(mocks.push).not.toHaveBeenCalled();
  fireEvent.keyDown(second, { key: "Home" }); expect(document.activeElement).toBe(first);
  fireEvent.keyDown(first, { key: "End" }); expect(document.activeElement).toBe(second);
  fireEvent.keyDown(second, { key: "ArrowRight" }); expect(document.activeElement).toBe(first);
  fireEvent.keyDown(first, { key: "ArrowRight" }); expect(document.activeElement).toBe(second);
  fireEvent.keyDown(second, { key: "Enter" });
  await waitFor(() => expect(mocks.orders).toHaveBeenCalledOnce());
  expect(second.getAttribute("aria-selected")).toBe("true");
  fireEvent.keyDown(second, { key: "ArrowRight" }); fireEvent.keyDown(first, { key: " " });
  await waitFor(() => expect(mocks.reservations).toHaveBeenCalledTimes(2));
  expect(first.getAttribute("aria-selected")).toBe("true");
  expect(mocks.push).toHaveBeenCalledTimes(2);
});

it("retains independent parent pagination when inactive lists unmount", async () => {
  render(<AccountReservationsPage />); await nextEnabled();
  fireEvent.click(screen.getByRole("button", { name: "بعدی" }));
  await waitFor(() => expect(mocks.reservations).toHaveBeenLastCalledWith("/account/reservations?page=2&pageSize=10&sort=createddesc"));
  fireEvent.click(orderTab()); await nextEnabled();
  fireEvent.click(screen.getByRole("button", { name: "بعدی" }));
  await waitFor(() => expect(mocks.orders).toHaveBeenLastCalledWith(2, 10)); await nextEnabled();
  fireEvent.click(screen.getByRole("button", { name: "بعدی" }));
  await waitFor(() => expect(mocks.orders).toHaveBeenLastCalledWith(3, 10));
  fireEvent.click(reservationTab()); await nextEnabled();
  expect(mocks.reservations).toHaveBeenLastCalledWith("/account/reservations?page=2&pageSize=10&sort=createddesc");
  fireEvent.click(orderTab()); await nextEnabled();
  expect(mocks.orders).toHaveBeenLastCalledWith(3, 10);
});

it.each(["reservations", "orders"])("preserves auth redirects and blocks %s fetching for anonymous guests", tab => {
  mocks.query = `tab=${tab}`; mocks.session.authenticated = false;
  render(<AccountReservationsPage />);
  expect(mocks.replace).toHaveBeenCalledWith("/login");
  expect(mocks.orders).not.toHaveBeenCalled(); expect(mocks.reservations).not.toHaveBeenCalled();
});

it("retains existing session detail links inside the orders panel", async () => {
  mocks.query = "tab=orders";
  mocks.orders.mockResolvedValue({ items: [{ sessionCode: "BS-ONE", property: { name: "اقامتگاه آزمون" }, totalAmount: 100,
    reservationCount: 1, derivedStatus: "PaymentSuccessful", paymentStatus: "Successful", paymentDeadlineUtc: null }], totalPages: 1 });
  render(<AccountReservationsPage />);
  expect((await screen.findByRole("link", { name: "جزئیات" })).getAttribute("href")).toBe("/account/booking-sessions/BS-ONE");
  expect(mocks.reservations).not.toHaveBeenCalled();
});

it("keeps narrow layouts, keyboard focus and reduced motion in scoped tab styles", () => {
  const css = readFileSync(resolve("app/account/reservations/page.module.css"), "utf8");
  expect(css).toContain("flex-wrap: wrap"); expect(css).toContain("height: 3px");
  expect(css).toContain(":focus-visible"); expect(css).toContain(".panel[hidden] { display: none; }");
  expect(css).toContain("prefers-reduced-motion: reduce"); expect(css).not.toContain(":global");
});
