import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AccountBookingSession } from "@/lib/booking-sessions";

const navigation = vi.hoisted(() => ({
  router: { push: vi.fn(), replace: vi.fn() },
}));
const bookingApi = vi.hoisted(() => ({ fetch: vi.fn(), initiate: vi.fn() }));

vi.mock("next/navigation", () => ({
  useParams: () => ({ sessionCode: "BS-1405-001" }),
  useRouter: () => navigation.router,
}));
vi.mock("@/components/auth/AuthSessionProvider", () => ({
  useAuthSession: () => ({ authenticated: true, loading: false }),
}));
vi.mock("@/lib/booking-sessions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/booking-sessions")>();
  return {
    ...actual,
    fetchAccountBookingSession: bookingApi.fetch,
    initiateAccountBookingSessionPayment: bookingApi.initiate,
  };
});
vi.mock("@/lib/currency", () => ({
  formatCurrency: (value: number) => `${value.toLocaleString("fa-IR")} تومان`,
  useSiteCurrencyLabel: () => "تومان",
}));

import AccountBookingSessionPage from "@/app/account/booking-sessions/[sessionCode]/page";

function response(): AccountBookingSession {
  const approvalDeadline = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  return {
    sessionCode: "BS-1405-001",
    displayCodeLabel: "کد سفارش",
    property: { propertyId: 1, name: "خانه کاشان", slug: "kashan-house" },
    currency: "IRR",
    totalAmount: 4_000_000,
    summary: {
      derivedStatus: "AwaitingApprovals",
      reservationCount: 2,
      totalAmount: 4_000_000,
      earliestCheckInDate: "2026-08-10",
      latestCheckOutDate: "2026-08-12",
      isPaymentReady: false,
      hasPendingApprovals: true,
      hasRejectedReservations: false,
      hasInconsistentPaymentDeadlines: false,
      earliestPaymentDeadlineUtc: null,
      earliestApprovalDeadlineUtc: approvalDeadline,
      statusCounts: [{ status: "PendingApproval", count: 2 }],
    },
    commonPaymentDeadlineUtc: null,
    payment: null,
    reservations: [
      { reservationNumber: "R-001", roomTypeId: 10, roomTypeName: "شاه‌نشین", roomId: 101, roomName: "اتاق ۱۰۱", checkInDate: "2026-08-10", checkOutDate: "2026-08-12", status: "PendingApproval", approvalExpiresAtUtc: approvalDeadline, paymentExpiresAtUtc: null, finalAmount: 2_000_000, currency: "IRR" },
      { reservationNumber: "R-002", roomTypeId: 10, roomTypeName: "شاه‌نشین", roomId: 102, roomName: "اتاق ۱۰۲", checkInDate: "2026-08-10", checkOutDate: "2026-08-12", status: "PendingApproval", approvalExpiresAtUtc: approvalDeadline, paymentExpiresAtUtc: null, finalAmount: 2_000_000, currency: "IRR" },
    ],
  };
}

describe("account booking session detail", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_INTERNAL_TEST_PAYMENTS_ENABLED", "true");
    bookingApi.fetch.mockResolvedValue(response());
    bookingApi.initiate.mockResolvedValue({
      paymentId: 10,
      status: "Pending",
      checkoutDestination: "/booking/sessions/BS-1405-001/mock-payment",
    });
  });

  it("shows the session code and each independent reservation", async () => {
    render(<AccountBookingSessionPage />);
    expect(await screen.findByText("BS-1405-001")).toBeTruthy();
    const section = screen.getByRole("heading", { name: "رزروهای این سفارش" }).closest("section");
    expect(section).toBeTruthy();
    expect(within(section!).getByText("R-001")).toBeTruthy();
    expect(within(section!).getByText("R-002")).toBeTruthy();
    expect(bookingApi.fetch).toHaveBeenCalledWith("BS-1405-001");
  });

  it("shows the OnRequest waiting state without a payment action", async () => {
    render(<AccountBookingSessionPage />);
    expect(await screen.findByText("در انتظار پاسخ اقامتگاه")).toBeTruthy();
    expect(screen.getByText("رزرو پس از تأیید مالک قابل پرداخت خواهد شد.")).toBeTruthy();
    expect(screen.getByText("مهلت باقی‌مانده برای پاسخ مالک")).toBeTruthy();
    expect(screen.getByRole("timer").textContent).toMatch(/[۰-۹]/);
    expect(screen.queryByRole("button", { name: /پرداخت/ })).toBeNull();
    expect(screen.queryByText("مهلت پرداخت")).toBeNull();
  });

  it("refreshes backend state when the approval countdown expires", async () => {
    const expired = response();
    const expiredDeadline = new Date(Date.now() - 1_000).toISOString();
    expired.summary.earliestApprovalDeadlineUtc = expiredDeadline;
    expired.reservations = expired.reservations.map((reservation) => ({
      ...reservation,
      approvalExpiresAtUtc: expiredDeadline,
    }));
    const rejected = response();
    rejected.summary.hasPendingApprovals = false;
    rejected.summary.hasRejectedReservations = true;
    rejected.summary.earliestApprovalDeadlineUtc = null;
    rejected.reservations = rejected.reservations.map((reservation) => ({
      ...reservation,
      status: "Rejected",
    }));
    bookingApi.fetch
      .mockResolvedValueOnce(expired)
      .mockResolvedValueOnce(rejected);

    render(<AccountBookingSessionPage />);

    expect(await screen.findByText("یک یا چند رزرو رد شده است")).toBeTruthy();
    expect(bookingApi.fetch.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("shows payment only when ready and initiates server-side checkout", async () => {
    const ready = response();
    ready.summary.hasPendingApprovals = false;
    ready.summary.isPaymentReady = true;
    ready.summary.earliestApprovalDeadlineUtc = null;
    ready.summary.earliestPaymentDeadlineUtc = new Date(
      Date.now() + 10 * 60 * 1000,
    ).toISOString();
    ready.commonPaymentDeadlineUtc = ready.summary.earliestPaymentDeadlineUtc;
    ready.reservations = ready.reservations.map((reservation) => ({
      ...reservation,
      status: "ApprovedAwaitingPayment",
      paymentExpiresAtUtc: ready.commonPaymentDeadlineUtc,
    }));
    bookingApi.fetch.mockResolvedValue(ready);
    render(<AccountBookingSessionPage />);

    const button = await screen.findByRole("button", { name: "پرداخت" });
    expect(
      screen.getByText(
        "ظرفیت این اتاق تا پایان مهلت پرداخت برای شما نگه داشته شده است.",
      ),
    ).toBeTruthy();
    expect(screen.getByText("مهلت پرداخت")).toBeTruthy();
    expect(screen.getByRole("timer").textContent).toMatch(/[۰-۹]/);
    button.click();

    await vi.waitFor(() => expect(bookingApi.initiate).toHaveBeenCalledOnce());
    expect(navigation.router.push).toHaveBeenCalledWith(
      "/booking/sessions/BS-1405-001/mock-payment",
    );
  });

  it("shows reservation dates only in the Persian calendar", async () => {
    render(<AccountBookingSessionPage />);

    expect(await screen.findAllByText(/۱۴۰۵/)).not.toHaveLength(0);
    expect(screen.queryByText(/2030-08-/)).toBeNull();
  });
});
