import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  apiRequest: vi.fn(),
  currencyLabel: "تومان",
  onView: vi.fn(),
  router: { replace: vi.fn() },
  session: {
    authenticated: true,
    loading: false,
    workspaces: ["account"],
  },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => mocks.router,
  usePathname: () => "/account/reservations",
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/components/auth/AuthSessionProvider", () => ({
  resolveSessionDestination: () => "/account",
  useAuthSession: () => mocks.session,
}));

vi.mock("@/lib/currency", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/currency")>();
  return { ...actual, useSiteCurrencyLabel: () => mocks.currencyLabel };
});

vi.mock("@/lib/owner-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/owner-api")>();
  return { ...actual, apiRequest: mocks.apiRequest };
});

import AccountReservationsPage from "@/app/account/reservations/page";
import {
  ReservationTable,
  type ReservationTableItem,
} from "@/components/reservations/ReservationTable";

const reservation: ReservationTableItem = {
  reservationId: 17,
  reservationNumber: "KCH-17",
  propertyName: "خانه کاشان",
  roomTypeName: "اتاق شاه‌نشین",
  guestName: "مهمان آزمون",
  guestMobile: "09121234567",
  checkInDate: "2030-08-10",
  checkOutDate: "2030-08-12",
  status: "Confirmed",
  finalAmount: 1_250_000,
  remainingAmount: 500_000,
};

describe("reservation list currency context", () => {
  it("shows one details link and an authoritative order label unchanged across list pages", () => {
    const item = { ...reservation, bookingSessionId: 8, bookingSessionCode: "B-ROOMS", linkedReservationCount: 3 };
    const props = { context: "admin" as const, currentPage: 1, loading: false, onPageChange: vi.fn(), onView: mocks.onView, totalPages: 3,
      detailsHref: (row: ReservationTableItem) => `/admin/reservations/${row.reservationId}` };
    const { rerender } = render(<ReservationTable {...props} reservations={[item]} />);
    expect(screen.getByRole("link", { name: /KCH-/ }).getAttribute("href")).toBe("/admin/reservations/17");
    expect(screen.getByText((_, node) => node?.tagName === "P" && node.textContent === "سفارش B-ROOMS · ۳ رزرو مرتبط")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "مشاهده رزرو" })).toBeNull();
    expect(screen.queryByRole("columnheader", { name: "عملیات" })).toBeNull();
    rerender(<ReservationTable {...props} currentPage={2} reservations={[{ ...item, reservationId: 18, reservationNumber: "KCH-18" }]} />);
    expect(screen.getByText((_, node) => node?.tagName === "P" && node.textContent === "سفارش B-ROOMS · ۳ رزرو مرتبط")).toBeTruthy();
  });

  it.each([undefined, 0, 1])("does not invent an order label for a standalone/single or unknown count %s", count => {
    render(<ReservationTable context="admin" currentPage={1} loading={false} onPageChange={vi.fn()} onView={vi.fn()}
      totalPages={1} reservations={[{ ...reservation, bookingSessionCode: "B-SINGLE", linkedReservationCount: count }]} />);
    expect(screen.queryByText(/رزرو مرتبط/)).toBeNull();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.currencyLabel = "تومان";
    mocks.apiRequest.mockResolvedValue({
      items: [
        {
          ...reservation,
          id: 17,
          nightsCount: 2,
          adults: 2,
          children: 0,
          roomCount: 1,
          totalPrice: 1_250_000,
          paidAmount: 750_000,
          currency: "IRR",
        },
      ],
      totalCount: 1,
      page: 1,
      pageSize: 10,
      totalPages: 1,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("keeps the standalone list and pagination visible under in-page tabs without combining API data", async () => {
    mocks.apiRequest.mockResolvedValue({ items: [{ ...reservation, totalPrice: 1_250_000, paidAmount: 750_000 }], totalPages: 2 });
    render(<AccountReservationsPage />);
    const nav = screen.getByRole("tablist", { name: "رزروهای من" });
    const standalone = within(nav).getByRole("tab", { name: "رزروها" });
    expect(standalone.getAttribute("aria-selected")).toBe("true");
    const orders = within(nav).getByRole("tab", { name: "سفارش‌ها" });
    expect(orders.getAttribute("aria-selected")).toBe("false");
    expect(within(nav).queryByRole("link")).toBeNull();
    expect(await screen.findByText("KCH-17")).toBeTruthy();
    expect(screen.getByRole("region", { name: "فهرست رزروها" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "جزئیات" }).getAttribute("href")).toBe("/account/reservations/KCH-17");
    expect(mocks.apiRequest).toHaveBeenCalledTimes(1);
    expect(mocks.apiRequest).toHaveBeenCalledWith("/account/reservations?page=1&pageSize=10&sort=createddesc");
    fireEvent.click(screen.getByRole("button", { name: "بعدی" }));
    await waitFor(() => expect(mocks.apiRequest).toHaveBeenLastCalledWith("/account/reservations?page=2&pageSize=10&sort=createddesc"));
    expect(await screen.findByRole("region", { name: "فهرست رزروها" })).toBeTruthy();
  });

  it("shows a configured unit once per monetary column for shared Admin and Owner tables", () => {
    mocks.currencyLabel = "ریال آزمایشی";
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const view = render(
      <ReservationTable
        context="admin"
        currentPage={1}
        loading={false}
        onPageChange={vi.fn()}
        onView={mocks.onView}
        reservations={[reservation]}
        totalPages={1}
      />,
    );

    expect(
      screen.getByRole("columnheader", {
        name: "مبلغ کل (ریال آزمایشی)",
      }),
    ).toBeTruthy();
    expect(
      screen.getByRole("columnheader", {
        name: "باقی‌مانده (ریال آزمایشی)",
      }),
    ).toBeTruthy();
    expect(screen.getAllByText(/ریال آزمایشی/)).toHaveLength(2);
    expect(screen.getByText("۱٬۲۵۰٬۰۰۰")).toBeTruthy();
    expect(screen.getByText("۵۰۰٬۰۰۰")).toBeTruthy();
    expect(screen.getByText("خانه کاشان")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "مشاهده رزرو" }));
    expect(mocks.onView).toHaveBeenCalledWith(reservation);

    view.rerender(
      <ReservationTable
        context="owner"
        currentPage={1}
        loading={false}
        onPageChange={vi.fn()}
        onView={mocks.onView}
        reservations={[reservation]}
        totalPages={1}
      />,
    );
    expect(screen.queryByRole("columnheader", { name: "اقامتگاه" })).toBeNull();
    expect(
      screen.getByRole("columnheader", {
        name: "مبلغ کل (ریال آزمایشی)",
      }),
    ).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("shows the canonical fallback in ReservationTable headers", () => {
    render(
      <ReservationTable
        context="owner"
        currentPage={1}
        loading={false}
        onPageChange={vi.fn()}
        onView={mocks.onView}
        reservations={[reservation]}
        totalPages={1}
      />,
    );

    expect(
      screen.getByRole("columnheader", { name: "مبلغ کل (تومان)" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("columnheader", { name: "باقی‌مانده (تومان)" }),
    ).toBeTruthy();
  });

  it("keeps Admin manual amounts in their API currency, including mixed-currency rows", () => {
    render(<ReservationTable context="admin" currentPage={1} loading={false}
      onPageChange={vi.fn()} onView={mocks.onView} totalPages={1} reservations={[
        { ...reservation, source: "AdminCreated", currency: "IRR", finalAmount: 5_000_000, remainingAmount: 5_000_000 },
        { ...reservation, reservationId: 18, source: "AdminCreated", currency: "USD", finalAmount: 100, remainingAmount: 100 },
        { ...reservation, reservationId: 19, source: "Website" },
      ]} />);
    expect(screen.getByRole("columnheader", { name: "مبلغ کل" })).toBeTruthy();
    expect(screen.queryByRole("columnheader", { name: "مبلغ کل (تومان)" })).toBeNull();
    expect(screen.getAllByText("۵٬۰۰۰٬۰۰۰ ریال")).toHaveLength(2);
    expect(screen.getAllByText("۱۰۰ USD")).toHaveLength(2);
    expect(screen.getByText("۱٬۲۵۰٬۰۰۰ تومان")).toBeTruthy();
    expect(screen.getByText("۵۰۰٬۰۰۰ تومان")).toBeTruthy();
  });

  it("shows the configured unit in Account reservations without changing amounts", async () => {
    mocks.currencyLabel = "ریال آزمایشی";
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    render(<AccountReservationsPage />);

    expect(await screen.findByText("KCH-17")).toBeTruthy();
    expect(
      screen.getByText("مبلغ کل (ریال آزمایشی)"),
    ).toBeTruthy();
    expect(
      screen.getByText("باقی‌مانده (ریال آزمایشی)"),
    ).toBeTruthy();
    expect(screen.getAllByText(/ریال آزمایشی/)).toHaveLength(2);
    expect(screen.getByText("۱٬۲۵۰٬۰۰۰")).toBeTruthy();
    expect(screen.getByText("۵۰۰٬۰۰۰")).toBeTruthy();
    expect(mocks.apiRequest).toHaveBeenCalledWith(
      "/account/reservations?page=1&pageSize=10&sort=createddesc",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps the canonical fallback in Account reservations", async () => {
    render(<AccountReservationsPage />);

    await waitFor(() =>
      expect(
        screen.getByText("مبلغ کل (تومان)"),
      ).toBeTruthy(),
    );
    expect(
      screen.getByText("باقی‌مانده (تومان)"),
    ).toBeTruthy();
  });
});
