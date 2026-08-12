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
import type { AccountBookingSession } from "@/lib/booking-sessions";

function session(paymentStatus = "Pending") {
  const paymentDeadline = new Date(Date.now() + 10 * 60 * 1000).toISOString();
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
      originalTotalAmount: 300,
      earliestCheckInDate: "2026-08-10",
      latestCheckOutDate: "2026-08-12",
      isPaymentReady: paymentStatus !== "Successful",
      canContinueWithApprovedReservations: false,
      payableReservationCount: paymentStatus === "Successful" ? 0 : 2,
      payableAmount: paymentStatus === "Successful" ? 0 : 300,
      continuationPaymentDeadlineUtc: null,
      hasPendingApprovals: false,
      hasRejectedReservations: false,
      hasInconsistentPaymentDeadlines: false,
      earliestPaymentDeadlineUtc: paymentDeadline,
      earliestApprovalDeadlineUtc: null,
      statusCounts: [],
    },
    commonPaymentDeadlineUtc: paymentDeadline,
    payment: { paymentId: 50, status: paymentStatus, amount: 300, currency: "IRR", provider: "internal-test", appliedAtUtc: paymentStatus === "Successful" ? "2026-08-05T10:00:00Z" : null },
    reservations: [
      { reservationNumber: "R-1", roomTypeId: 10, roomTypeName: "اتاق یک", roomId: 101, roomName: "۱۰۱", checkInDate: "2026-08-10", checkOutDate: "2026-08-12", status: paymentStatus === "Successful" ? "Confirmed" : "ApprovedAwaitingPayment", approvalExpiresAtUtc: null, paymentExpiresAtUtc: paymentDeadline, finalAmount: 100, currency: "IRR" },
      { reservationNumber: "R-2", roomTypeId: 11, roomTypeName: "اتاق دو", roomId: 102, roomName: "۱۰۲", checkInDate: "2026-08-10", checkOutDate: "2026-08-12", status: paymentStatus === "Successful" ? "Confirmed" : "ApprovedAwaitingPayment", approvalExpiresAtUtc: null, paymentExpiresAtUtc: paymentDeadline, finalAmount: 200, currency: "IRR" },
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

  it("describes a successful mixed payment without claiming every child was confirmed", async () => {
    const mixed = session("Successful");
    mixed.summary.derivedStatus = "Mixed";
    mixed.summary.hasRejectedReservations = true;
    mixed.summary.originalTotalAmount = 300;
    mixed.summary.payableAmount = 100;
    mixed.payment.amount = 100;
    mixed.reservations[1].status = "Rejected";
    api.fetch.mockResolvedValue(mixed);

    render(<BookingPaymentResult mode="success" sessionCode="BS-PAY-1" />);

    expect(await screen.findByText(/پرداخت رزروهای تأییدشده با موفقیت ثبت شد/)).toBeTruthy();
    expect(screen.queryByText("تمام رزروهای این سفارش تأیید شدند.")).toBeNull();
    expect(screen.getByText("مبلغ اولیه سفارش")).toBeTruthy();
    expect(screen.getByText("مبلغ پرداخت‌شده")).toBeTruthy();
    expect(screen.getByText("R-2")).toBeTruthy();
  });

  it("failure page routes a payable retry through canonical session details", async () => {
    api.fetch.mockResolvedValue(session("Failed"));
    render(<BookingPaymentResult mode="failure" sessionCode="BS-PAY-1" />);
    const retry = await screen.findByRole("button", { name: "تلاش مجدد برای پرداخت" });
    fireEvent.click(retry);
    expect(navigation.router.push).toHaveBeenCalledWith(
      "/account/booking-sessions/BS-PAY-1",
    );
    expect(api.initiate).not.toHaveBeenCalled();
  });

  it.each([
    { name: "expired", deadline: new Date(Date.now() - 1_000).toISOString(), status: "Failed" },
    { name: "successful", deadline: new Date(Date.now() + 60_000).toISOString(), status: "Successful" },
  ])("failure page hides retry for a $name session", async ({ deadline, status }) => {
    const value = session(status);
    value.commonPaymentDeadlineUtc = deadline;
    value.summary.earliestPaymentDeadlineUtc = deadline;
    value.reservations.forEach((reservation) => { reservation.paymentExpiresAtUtc = deadline; });
    api.fetch.mockResolvedValue(value);

    render(<BookingPaymentResult mode="failure" sessionCode="BS-PAY-1" />);

    expect(await screen.findByText("BS-PAY-1")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "تلاش مجدد برای پرداخت" })).toBeNull();
  });

  it("keeps mixed continuation retry available after a failed attempt", async () => {
    const value = session("Failed") as AccountBookingSession;
    value.summary.isPaymentReady = false;
    value.summary.canContinueWithApprovedReservations = true;
    value.summary.payableReservationCount = 1;
    value.summary.continuationPaymentDeadlineUtc = value.commonPaymentDeadlineUtc;
    value.summary.hasRejectedReservations = true;
    value.reservations[1].status = "Rejected";
    api.fetch.mockResolvedValue(value);

    render(<BookingPaymentResult mode="failure" sessionCode="BS-PAY-1" />);

    expect(await screen.findByRole("button", { name: "تلاش مجدد برای پرداخت" })).toBeTruthy();
  });
});
