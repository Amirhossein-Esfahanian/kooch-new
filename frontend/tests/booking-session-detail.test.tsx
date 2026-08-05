import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

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

function response() {
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
      statusCounts: [{ status: "PendingApproval", count: 2 }],
    },
    commonPaymentDeadlineUtc: null,
    payment: null,
    reservations: [
      { reservationNumber: "R-001", roomTypeId: 10, roomTypeName: "شاه‌نشین", roomId: 101, roomName: "اتاق ۱۰۱", checkInDate: "2026-08-10", checkOutDate: "2026-08-12", status: "PendingApproval", paymentExpiresAtUtc: null, finalAmount: 2_000_000, currency: "IRR" },
      { reservationNumber: "R-002", roomTypeId: 10, roomTypeName: "شاه‌نشین", roomId: 102, roomName: "اتاق ۱۰۲", checkInDate: "2026-08-10", checkOutDate: "2026-08-12", status: "PendingApproval", paymentExpiresAtUtc: null, finalAmount: 2_000_000, currency: "IRR" },
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
    expect(await screen.findByText("در انتظار تأیید مالک")).toBeTruthy();
    expect(screen.getByText(/پس از تأیید همه اتاق‌ها/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /پرداخت/ })).toBeNull();
  });

  it("shows payment only when ready and initiates server-side checkout", async () => {
    const ready = response();
    ready.summary.hasPendingApprovals = false;
    ready.summary.isPaymentReady = true;
    bookingApi.fetch.mockResolvedValue(ready);
    render(<AccountBookingSessionPage />);

    const button = await screen.findByRole("button", { name: "پرداخت" });
    button.click();

    await vi.waitFor(() => expect(bookingApi.initiate).toHaveBeenCalledOnce());
    expect(navigation.router.push).toHaveBeenCalledWith(
      "/booking/sessions/BS-1405-001/mock-payment",
    );
  });
});
