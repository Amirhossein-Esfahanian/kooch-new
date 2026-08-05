import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const navigation = vi.hoisted(() => ({
  router: { push: vi.fn(), replace: vi.fn() },
}));
const api = vi.hoisted(() => ({
  fetch: vi.fn(),
  initiate: vi.fn(),
  simulate: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => navigation.router }));
vi.mock("@/components/auth/AuthSessionProvider", () => ({
  useAuthSession: () => ({ authenticated: true, loading: false }),
}));
vi.mock("@/lib/booking-sessions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/booking-sessions")>();
  return {
    ...actual,
    fetchAccountBookingSession: api.fetch,
    initiateAccountBookingSessionPayment: api.initiate,
    simulateMockBookingSessionPayment: api.simulate,
  };
});
vi.mock("@/lib/currency", () => ({
  formatCurrency: (value: number) => `${value.toLocaleString("fa-IR")} تومان`,
  useSiteCurrencyLabel: () => "تومان",
}));

import { BookingPaymentResult } from "@/components/booking/BookingPaymentResult";
import { MockPaymentCheckout } from "@/components/booking/MockPaymentCheckout";

function session(paymentStatus = "Pending") {
  return {
    sessionCode: "BS-PAY-1",
    displayCodeLabel: "کد سفارش",
    property: { propertyId: 1, name: "خانه کاشان", slug: "kashan" },
    currency: "IRR",
    totalAmount: 300,
    summary: {
      derivedStatus: paymentStatus === "Successful" ? "Confirmed" : "ApprovedAwaitingPayment",
      reservationCount: 2,
      totalAmount: 300,
      earliestCheckInDate: "2026-08-10",
      latestCheckOutDate: "2026-08-12",
      isPaymentReady: paymentStatus !== "Successful",
      hasPendingApprovals: false,
      hasRejectedReservations: false,
      hasInconsistentPaymentDeadlines: false,
      earliestPaymentDeadlineUtc: "2026-08-09T10:00:00Z",
      statusCounts: [],
    },
    commonPaymentDeadlineUtc: "2026-08-09T10:00:00Z",
    payment: { paymentId: 50, status: paymentStatus, amount: 300, currency: "IRR", provider: "internal-test", appliedAtUtc: paymentStatus === "Successful" ? "2026-08-05T10:00:00Z" : null },
    reservations: [
      { reservationNumber: "R-1", roomTypeId: 10, roomTypeName: "اتاق یک", roomId: 101, roomName: "۱۰۱", checkInDate: "2026-08-10", checkOutDate: "2026-08-12", status: paymentStatus === "Successful" ? "Confirmed" : "ApprovedAwaitingPayment", paymentExpiresAtUtc: "2026-08-09T10:00:00Z", finalAmount: 100, currency: "IRR" },
      { reservationNumber: "R-2", roomTypeId: 11, roomTypeName: "اتاق دو", roomId: 102, roomName: "۱۰۲", checkInDate: "2026-08-10", checkOutDate: "2026-08-12", status: paymentStatus === "Successful" ? "Confirmed" : "ApprovedAwaitingPayment", paymentExpiresAtUtc: "2026-08-09T10:00:00Z", finalAmount: 200, currency: "IRR" },
    ],
  };
}

describe("mock booking session payment", () => {
  beforeEach(() => {
    api.fetch.mockResolvedValue(session());
    api.simulate.mockResolvedValue({ state: "failed", redirectDestination: "/booking/sessions/BS-PAY-1/payment-failure" });
    api.initiate.mockResolvedValue({ checkoutDestination: "/booking/sessions/BS-PAY-1/mock-payment" });
  });

  it("shows safe session data and simulates failure through the server", async () => {
    render(<MockPaymentCheckout sessionCode="BS-PAY-1" />);
    expect(await screen.findByText("BS-PAY-1")).toBeTruthy();
    expect(screen.getByText("R-1")).toBeTruthy();
    expect(screen.getByText("R-2")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "شکست پرداخت آزمایشی" }));
    await vi.waitFor(() => expect(api.simulate).toHaveBeenCalledWith("BS-PAY-1", false));
    expect(document.body.textContent).not.toContain("secret");
    expect(document.body.textContent).not.toContain("callback");
  });

  it("success page displays every reservation and successful payment state", async () => {
    api.fetch.mockResolvedValue(session("Successful"));
    render(<BookingPaymentResult mode="success" sessionCode="BS-PAY-1" />);
    expect(await screen.findByText("پرداخت با موفقیت ثبت شد")).toBeTruthy();
    expect(screen.getByText("R-1")).toBeTruthy();
    expect(screen.getByText("R-2")).toBeTruthy();
    expect(screen.getByText("Successful")).toBeTruthy();
  });

  it("failure page offers a safe idempotent retry", async () => {
    render(<BookingPaymentResult mode="failure" sessionCode="BS-PAY-1" />);
    const retry = await screen.findByRole("button", { name: "تلاش دوباره برای پرداخت" });
    fireEvent.click(retry);
    await vi.waitFor(() => expect(api.initiate).toHaveBeenCalledOnce());
    expect(navigation.router.push).toHaveBeenCalledWith(
      "/booking/sessions/BS-PAY-1/mock-payment",
    );
  });
});
