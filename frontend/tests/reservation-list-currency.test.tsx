import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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

  it("shows the configured unit in Account reservations without changing amounts", async () => {
    mocks.currencyLabel = "ریال آزمایشی";
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    render(<AccountReservationsPage />);

    expect(await screen.findByText("KCH-17")).toBeTruthy();
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
    expect(mocks.apiRequest).toHaveBeenCalledWith(
      "/account/reservations?page=1&pageSize=10&sort=createddesc",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps the canonical fallback in Account reservations", async () => {
    render(<AccountReservationsPage />);

    await waitFor(() =>
      expect(
        screen.getByRole("columnheader", { name: "مبلغ کل (تومان)" }),
      ).toBeTruthy(),
    );
    expect(
      screen.getByRole("columnheader", { name: "باقی‌مانده (تومان)" }),
    ).toBeTruthy();
  });
});
