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
      originalTotalAmount: 4_000_000,
      earliestCheckInDate: "2026-08-10",
      latestCheckOutDate: "2026-08-12",
      isPaymentReady: false,
      canContinueWithApprovedReservations: false,
      payableReservationCount: 0,
      payableAmount: 0,
      continuationPaymentDeadlineUtc: null,
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

function readyResponse(deadline = new Date(Date.now() + 10 * 60 * 1000).toISOString()): AccountBookingSession {
  const ready = response();
  ready.summary.hasPendingApprovals = false;
  ready.summary.isPaymentReady = true;
  ready.summary.earliestApprovalDeadlineUtc = null;
  ready.summary.earliestPaymentDeadlineUtc = deadline;
  ready.commonPaymentDeadlineUtc = deadline;
  ready.reservations = ready.reservations.map((reservation) => ({
    ...reservation,
    status: "ApprovedAwaitingPayment",
    paymentExpiresAtUtc: deadline,
  }));
  return ready;
}

function mixedResponse(deadline = new Date(Date.now() + 10 * 60 * 1000).toISOString()): AccountBookingSession {
  const mixed = readyResponse(deadline);
  mixed.summary.derivedStatus = "Mixed";
  mixed.summary.isPaymentReady = false;
  mixed.summary.canContinueWithApprovedReservations = true;
  mixed.summary.payableReservationCount = 1;
  mixed.summary.payableAmount = 2_000_000;
  mixed.summary.continuationPaymentDeadlineUtc = deadline;
  mixed.summary.hasRejectedReservations = true;
  mixed.summary.earliestPaymentDeadlineUtc = deadline;
  mixed.commonPaymentDeadlineUtc = null;
  mixed.reservations[1] = {
    ...mixed.reservations[1],
    status: "Rejected",
    paymentExpiresAtUtc: null,
  };
  return mixed;
}

describe("account booking session detail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
    expect(await screen.findByText("در انتظار تعیین وضعیت همه رزروها")).toBeTruthy();
    expect(screen.getByText("رزرو پس از تأیید اقامتگاه قابل پرداخت خواهد شد.")).toBeTruthy();
    expect(screen.getByText("⌛ نیازمند تأیید اقامتگاه")).toBeTruthy();
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

    expect(await screen.findByText("بخشی از درخواست رزرو تأیید نشده است")).toBeTruthy();
    await vi.waitFor(() =>
      expect(bookingApi.fetch.mock.calls.length).toBeGreaterThanOrEqual(2),
    );
  });

  it("shows payment only when ready and initiates server-side checkout", async () => {
    const ready = readyResponse();
    bookingApi.fetch.mockResolvedValue(ready);
    render(<AccountBookingSessionPage />);

    const buttons = await screen.findAllByRole("button", { name: "پرداخت" });
    expect(
      screen.getByText(
        "ظرفیت این رزرو تا پایان مهلت پرداخت برای شما نگه داشته شده است.",
      ),
    ).toBeTruthy();
    expect(screen.getByText("مهلت پرداخت")).toBeTruthy();
    expect(screen.getByRole("timer").textContent).toMatch(/[۰-۹]/);
    buttons[0].click();

    await vi.waitFor(() => expect(bookingApi.initiate).toHaveBeenCalledOnce());
    expect(navigation.router.push).toHaveBeenCalledWith(
      "/booking/sessions/BS-1405-001/mock-payment",
    );
    expect(screen.getByTestId("session-payment-mobile-action")).toBeTruthy();
  });

  it("does not expose a broken payment route when mock checkout is disabled", async () => {
    vi.stubEnv("NEXT_PUBLIC_INTERNAL_TEST_PAYMENTS_ENABLED", "false");
    bookingApi.fetch.mockResolvedValue(readyResponse());

    render(<AccountBookingSessionPage />);

    expect(await screen.findByText(/درگاه پرداخت در حال حاضر در دسترس نیست/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "پرداخت" })).toBeNull();
  });

  it("groups a closed mixed outcome and continues with every approved reservation together", async () => {
    bookingApi.fetch.mockResolvedValue(mixedResponse());

    render(<AccountBookingSessionPage />);

    expect(await screen.findByText("بخشی از درخواست رزرو تأیید شده است")).toBeTruthy();
    expect(screen.getByText("تأییدشده و قابل پرداخت")).toBeTruthy();
    expect(screen.getByText("ردشده")).toBeTruthy();
    expect(within(screen.getByTestId("payable-reservations")).getByText("R-001")).toBeTruthy();
    expect(within(screen.getByTestId("rejected-reservations")).getByText("R-002")).toBeTruthy();
    expect(screen.getByText("مبلغ اولیه سفارش")).toBeTruthy();
    expect(screen.getAllByText("مبلغ قابل پرداخت")).not.toHaveLength(0);
    expect(screen.getByText("۱ رزرو")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "ادامه با رزروهای تأییدشده" })).toHaveLength(2);
    expect(screen.queryByRole("button", { name: /^پرداخت R-/ })).toBeNull();
  });

  it("uses the existing session payment initiation without sending reservation ids", async () => {
    bookingApi.fetch.mockResolvedValue(mixedResponse());
    render(<AccountBookingSessionPage />);

    const buttons = await screen.findAllByRole("button", { name: "ادامه با رزروهای تأییدشده" });
    buttons[0].click();

    await vi.waitFor(() => expect(bookingApi.initiate).toHaveBeenCalledOnce());
    expect(bookingApi.initiate.mock.calls[0]).toHaveLength(2);
    expect(bookingApi.initiate.mock.calls[0][0]).toBe("BS-1405-001");
  });

  it("offers one session-level continuation scope for two approved children", async () => {
    const mixed = mixedResponse();
    mixed.totalAmount = 6_000_000;
    mixed.summary.reservationCount = 3;
    mixed.summary.totalAmount = 6_000_000;
    mixed.summary.originalTotalAmount = 6_000_000;
    mixed.summary.payableReservationCount = 2;
    mixed.summary.payableAmount = 4_000_000;
    mixed.reservations.push({
      ...mixed.reservations[0],
      reservationNumber: "R-003",
      roomId: 103,
      roomName: "اتاق ۱۰۳",
    });
    bookingApi.fetch.mockResolvedValue(mixed);

    render(<AccountBookingSessionPage />);

    expect(await screen.findByText("۲ رزرو")).toBeTruthy();
    expect(within(screen.getByTestId("payable-reservations")).getAllByText(/R-00[13]/)).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: "ادامه با رزروهای تأییدشده" })).toHaveLength(2);
    expect(screen.queryByRole("button", { name: /R-001|R-003/ })).toBeNull();
  });

  it("waits when a mixed OnRequest session still has an unresolved child", async () => {
    const open = mixedResponse();
    open.summary.canContinueWithApprovedReservations = false;
    open.summary.payableReservationCount = 0;
    open.summary.payableAmount = 0;
    open.summary.continuationPaymentDeadlineUtc = null;
    open.summary.hasRejectedReservations = false;
    open.summary.hasPendingApprovals = true;
    open.reservations[1] = { ...open.reservations[1], status: "PendingApproval" };
    bookingApi.fetch.mockResolvedValue(open);

    render(<AccountBookingSessionPage />);

    expect(await screen.findByText("در انتظار تعیین وضعیت همه رزروها")).toBeTruthy();
    expect(screen.getByText(/پرداخت تا مشخص‌شدن وضعیت همه رزروها/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "ادامه با رزروهای تأییدشده" })).toBeNull();
  });

  it("removes continuation immediately at expiry and refreshes authoritative state", async () => {
    const deadline = new Date(Date.now() - 1_000).toISOString();
    const expiredLocally = mixedResponse(deadline);
    const expiredOnServer = mixedResponse(deadline);
    expiredOnServer.summary.canContinueWithApprovedReservations = false;
    expiredOnServer.summary.payableReservationCount = 0;
    expiredOnServer.summary.payableAmount = 0;
    expiredOnServer.summary.continuationPaymentDeadlineUtc = null;
    expiredOnServer.reservations[0] = { ...expiredOnServer.reservations[0], status: "PaymentExpired" };
    bookingApi.fetch.mockResolvedValueOnce(expiredLocally).mockResolvedValueOnce(expiredOnServer);

    render(<AccountBookingSessionPage />);

    expect(await screen.findByText("مهلت پرداخت به پایان رسیده است")).toBeTruthy();
    await vi.waitFor(() =>
      expect(bookingApi.fetch.mock.calls.length).toBeGreaterThanOrEqual(2),
    );
    expect(screen.queryByRole("button", { name: "ادامه با رزروهای تأییدشده" })).toBeNull();
  });

  it("keeps mixed continuation safe when mock payment UI is disabled", async () => {
    vi.stubEnv("NEXT_PUBLIC_INTERNAL_TEST_PAYMENTS_ENABLED", "false");
    bookingApi.fetch.mockResolvedValue(mixedResponse());
    render(<AccountBookingSessionPage />);

    expect(await screen.findByText(/درگاه پرداخت در حال حاضر در دسترس نیست/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "ادامه با رزروهای تأییدشده" })).toBeNull();
  });

  it("keeps confirmed and rejected children visible after a successful mixed payment", async () => {
    const successful = mixedResponse();
    successful.summary.canContinueWithApprovedReservations = false;
    successful.summary.payableReservationCount = 0;
    successful.summary.payableAmount = 0;
    successful.summary.continuationPaymentDeadlineUtc = null;
    successful.reservations[0] = { ...successful.reservations[0], status: "Confirmed" };
    successful.payment = {
      paymentId: 20,
      status: "Successful",
      amount: 2_000_000,
      currency: "IRR",
      provider: "internal-test",
      appliedAtUtc: new Date().toISOString(),
    };
    bookingApi.fetch.mockResolvedValue(successful);

    render(<AccountBookingSessionPage />);

    expect(await screen.findByText("نتیجه این سفارش ترکیبی است")).toBeTruthy();
    expect(within(screen.getByTestId("payable-reservations")).getByText("تایید شده")).toBeTruthy();
    expect(within(screen.getByTestId("rejected-reservations")).getAllByText("ردشده")).not.toHaveLength(0);
    expect(screen.getByText("مبلغ پرداخت‌شده")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "ادامه با رزروهای تأییدشده" })).toBeNull();
  });

  it("refreshes server state after the payment deadline and keeps payment disabled", async () => {
    const deadline = new Date(Date.now() - 1_000).toISOString();
    const expiredLocally = readyResponse(deadline);
    const expiredOnServer = readyResponse(deadline);
    expiredOnServer.summary.isPaymentReady = false;
    expiredOnServer.summary.earliestPaymentDeadlineUtc = null;
    expiredOnServer.commonPaymentDeadlineUtc = null;
    expiredOnServer.reservations = expiredOnServer.reservations.map((reservation) => ({
      ...reservation,
      status: "PaymentExpired",
    }));
    bookingApi.fetch
      .mockResolvedValueOnce(expiredLocally)
      .mockResolvedValueOnce(expiredOnServer);

    render(<AccountBookingSessionPage />);

    expect(await screen.findByText("مهلت پرداخت به پایان رسیده است")).toBeTruthy();
    expect(bookingApi.fetch.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByRole("button", { name: "پرداخت" })).toBeNull();
  });

  it("shows reservation dates only in the Persian calendar", async () => {
    render(<AccountBookingSessionPage />);

    expect(await screen.findAllByText(/۱۴۰۵/)).not.toHaveLength(0);
    expect(screen.queryByText(/2030-08-/)).toBeNull();
  });
});
