import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { GuestOrdersList } from "@/components/account/GuestOrdersList";
import { GuestReservationsList } from "@/components/account/GuestReservationsList";

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
