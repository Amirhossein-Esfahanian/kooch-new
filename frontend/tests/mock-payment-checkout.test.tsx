import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const navigation = vi.hoisted(() => ({
  router: { push: vi.fn(), replace: vi.fn() },
}));
vi.mock("@/components/booking/PropertyGuestAccount", () => ({ PropertyGuestAccount: () => null }));
const api = vi.hoisted(() => ({
  fetch: vi.fn(),
  fetchProviders: vi.fn(),
  initiate: vi.fn(),
  simulate: vi.fn(),
  publicProperty: vi.fn(),
}));
const authState = vi.hoisted(() => ({ authenticated: true }));

vi.mock("next/navigation", () => ({ useRouter: () => navigation.router }));
vi.mock("@/components/auth/AuthSessionProvider", () => ({
  useAuthSession: () => ({ authenticated: authState.authenticated, loading: false }),
}));
vi.mock("@/components/Header", () => ({ Header: () => <header>Marketplace header</header> }));
vi.mock("@/components/Footer", () => ({ Footer: () => <footer>Marketplace footer</footer> }));
vi.mock("@/components/booking/CheckoutIdentityStep", () => ({ CheckoutIdentityStep: () => <p>ورود درون‌صفحه‌ای</p> }));
vi.mock("@/lib/public-properties", () => ({ fetchPublicApi: api.publicProperty }));
vi.mock("@/lib/booking-sessions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/booking-sessions")>();
  return {
    ...actual,
    fetchAccountBookingSession: api.fetch,
    fetchAccountPaymentProviders: api.fetchProviders,
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
import { PropertyBookingPaymentEntry } from "@/components/booking/PropertyBookingPaymentEntry";
import type { AccountBookingSession } from "@/lib/booking-sessions";

function session(paymentStatus = "Pending") {
  const paymentDeadline = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  return {
    sessionCode: "BS-PAY-1",
    commissionType: 0 as 0 | 1 | 2 | null | undefined,
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
    vi.clearAllMocks();
    authState.authenticated = true;
    api.fetch.mockResolvedValue(session());
    api.fetchProviders.mockResolvedValue([{ value: "internal-test", label: "درگاه آزمایشی" }]);
    api.simulate.mockResolvedValue({ state: "failed", redirectDestination: "/booking/sessions/BS-PAY-1/payment-failure" });
    api.initiate.mockResolvedValue({ checkoutDestination: "/booking/sessions/BS-PAY-1/mock-payment" });
    api.publicProperty.mockResolvedValue({ id: 1, name: "خانه کاشان", slug: "kashan", status: "Approved" });
  });

  const directProperty = { id: 1, name: "خانه کاشان", slug: "kashan" };
  function directSession(status = "Pending") { return { ...session(status), commissionType: 2 as const }; }

  it.each(["success", "payment-failure", "mock-payment"] as const)("routes owned Direct %s returns using resolved Property, without Marketplace chrome", async (kind) => {
    api.fetch.mockResolvedValue(directSession());
    render(<PropertyBookingPaymentEntry sessionCode="BS-PAY-1" kind={kind} />);
    await vi.waitFor(() => expect(navigation.router.replace).toHaveBeenCalledWith(`/book/kashan/reservations/BS-PAY-1/${kind}`));
    expect(api.publicProperty).toHaveBeenCalledWith("/properties/kashan");
    expect(screen.queryByText("Marketplace header")).toBeNull();
    expect(api.simulate).not.toHaveBeenCalled();
    expect(api.initiate).not.toHaveBeenCalled();
  });

  it.each([0, 1, null] as const)("preserves generic result UI for channel %s", async (commissionType) => {
    api.fetch.mockResolvedValue({ ...session("Successful"), commissionType });
    render(<PropertyBookingPaymentEntry sessionCode="BS-PAY-1" kind="success" />);
    expect(await screen.findByText("پرداخت با موفقیت ثبت شد")).toBeTruthy();
    expect(screen.getByText("Marketplace header")).toBeTruthy();
    expect(screen.getByText("رزروهای من")).toBeTruthy();
    expect(navigation.router.replace).not.toHaveBeenCalled();
    expect(api.publicProperty).not.toHaveBeenCalled();
  });

  it.each([0, 1, null, undefined])("denies non-Direct or missing channel %s on a branded return", async (commissionType) => {
    api.fetch.mockResolvedValue({ ...session("Successful"), commissionType });
    render(<PropertyBookingPaymentEntry sessionCode="BS-PAY-1" kind="success" directProperty={directProperty} />);
    expect(await screen.findByText(/وضعیت سفارش قابل دریافت نیست یا/)).toBeTruthy();
    expect(screen.queryByText("R-1")).toBeNull();
    expect(screen.queryByText("پرداخت با موفقیت ثبت شد")).toBeNull();
    expect(api.simulate).not.toHaveBeenCalled();
  });

  it.each([
    { ...directProperty, id: 2 }, { ...directProperty, slug: "wrong-slug" },
  ])("denies mismatched Property on direct URL access", async (property) => {
    api.fetch.mockResolvedValue(directSession("Successful"));
    render(<PropertyBookingPaymentEntry sessionCode="BS-PAY-1" kind="success" directProperty={property} />);
    expect(await screen.findByText(/وضعیت سفارش قابل دریافت نیست یا/)).toBeTruthy();
    expect(screen.queryByText("R-1")).toBeNull();
  });

  it("rejects cross-Property substitution during generic return resolution", async () => {
    api.fetch.mockResolvedValue(directSession());
    api.publicProperty.mockResolvedValue({ ...directProperty, id: 2, status: "Approved" });
    render(<PropertyBookingPaymentEntry sessionCode="BS-PAY-1" kind="success" />);
    expect(await screen.findByText(/وضعیت سفارش قابل دریافت نیست یا/)).toBeTruthy();
    expect(navigation.router.replace).not.toHaveBeenCalled();
  });

  it("rejects missing channel on generic return rather than inferring Marketplace", async () => {
    api.fetch.mockResolvedValue({ ...session(), commissionType: undefined });
    render(<PropertyBookingPaymentEntry sessionCode="BS-PAY-1" kind="success" />);
    expect(await screen.findByText(/وضعیت سفارش قابل دریافت نیست یا/)).toBeTruthy();
    expect(screen.queryByText("Marketplace header")).toBeNull();
  });

  it("preserves owner rejection and exposes no booking details", async () => {
    api.fetch.mockRejectedValueOnce(new Error("404"));
    render(<PropertyBookingPaymentEntry sessionCode="BS-PAY-1" kind="success" directProperty={directProperty} />);
    expect(await screen.findByText(/وضعیت سفارش قابل دریافت نیست یا/)).toBeTruthy();
    expect(screen.queryByText("R-1")).toBeNull();
    expect(api.publicProperty).not.toHaveBeenCalled();
  });

  it("keeps unauthenticated branded returns inline and does not request private data", async () => {
    authState.authenticated = false;
    render(<PropertyBookingPaymentEntry sessionCode="BS-PAY-1" kind="success" directProperty={directProperty} />);
    expect(await screen.findByText("ورود درون‌صفحه‌ای")).toBeTruthy();
    expect(api.fetch).not.toHaveBeenCalled();
    expect(navigation.router.replace).not.toHaveBeenCalled();
  });

  it.each(["success", "failure"] as const)("Direct %s URL displays actual Successful state even on refresh", async (mode) => {
    api.fetch.mockResolvedValue(directSession("Successful"));
    const view = render(<PropertyBookingPaymentEntry sessionCode="BS-PAY-1" kind={mode === "success" ? "success" : "payment-failure"} directProperty={directProperty} />);
    expect(await screen.findByText("پرداخت با موفقیت ثبت شد")).toBeTruthy();
    expect(screen.queryByText("پرداخت تکمیل نشد")).toBeNull();
    expect(screen.queryByText("رزروهای من")).toBeNull();
    expect(screen.queryByText("Marketplace header")).toBeNull();
    expect(document.body.textContent).not.toMatch(/کیف پول|شارژ کیف/);
    fireEvent.click(screen.getByRole("button", { name: "جزئیات سفارش" }));
    expect(navigation.router.push).toHaveBeenCalledWith("/book/kashan/reservations/BS-PAY-1");
    view.unmount();
    render(<PropertyBookingPaymentEntry sessionCode="BS-PAY-1" kind="success" directProperty={directProperty} />);
    expect(await screen.findByText("پرداخت با موفقیت ثبت شد")).toBeTruthy();
    expect(api.simulate).not.toHaveBeenCalled();
    expect(api.initiate).not.toHaveBeenCalled();
  });

  it("Direct success URL does not conceal actual Failed state and retry remains Property scoped", async () => {
    api.fetch.mockResolvedValue(directSession("Failed"));
    render(<PropertyBookingPaymentEntry sessionCode="BS-PAY-1" kind="success" directProperty={directProperty} />);
    expect(await screen.findByText("پرداخت تکمیل نشد")).toBeTruthy();
    expect(screen.queryByText("پرداخت با موفقیت ثبت شد")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "تلاش مجدد برای پرداخت" }));
    expect(navigation.router.push).toHaveBeenCalledWith("/book/kashan/reservations/BS-PAY-1");
  });

  it.each(["success", "payment-failure"] as const)("Direct %s waits for server verification while Pending", async (kind) => {
    api.fetch.mockResolvedValue(directSession());
    render(<PropertyBookingPaymentEntry sessionCode="BS-PAY-1" kind={kind} directProperty={directProperty} />);
    expect(await screen.findByText("نتیجه پرداخت هنوز مشخص نیست")).toBeTruthy();
    expect(screen.queryByText("پرداخت با موفقیت ثبت شد")).toBeNull();
    expect(screen.queryByText("پرداخت تکمیل نشد")).toBeNull();
    expect(screen.queryByRole("button", { name: "تلاش مجدد برای پرداخت" })).toBeNull();
  });

  it("Direct unknown payment state is not success", async () => {
    api.fetch.mockResolvedValue({ ...directSession(), payment: null });
    render(<PropertyBookingPaymentEntry sessionCode="BS-PAY-1" kind="success" directProperty={directProperty} />);
    expect(await screen.findByText("نتیجه پرداخت هنوز مشخص نیست")).toBeTruthy();
    expect(screen.queryByText("پرداخت با موفقیت ثبت شد")).toBeNull();
  });

  it("Direct pending return becomes successful only after a fresh authoritative read", async () => {
    api.fetch.mockResolvedValueOnce(directSession()).mockResolvedValueOnce(directSession()).mockResolvedValue(directSession("Successful"));
    render(<PropertyBookingPaymentEntry sessionCode="BS-PAY-1" kind="payment-failure" directProperty={directProperty} />);
    expect(await screen.findByText("نتیجه پرداخت هنوز مشخص نیست")).toBeTruthy();
    expect(await screen.findByText("پرداخت با موفقیت ثبت شد", {}, { timeout: 3500 })).toBeTruthy();
    expect(api.fetch).toHaveBeenCalledTimes(3);
    expect(api.simulate).not.toHaveBeenCalled();
    expect(api.initiate).not.toHaveBeenCalled();
  });

  it("denies a mismatched session code even when Property and channel match", async () => {
    api.fetch.mockResolvedValue({ ...directSession("Successful"), sessionCode: "OTHER" });
    render(<PropertyBookingPaymentEntry sessionCode="BS-PAY-1" kind="success" directProperty={directProperty} />);
    expect(await screen.findByText(/وضعیت سفارش قابل دریافت نیست یا/)).toBeTruthy();
    expect(screen.queryByText("R-1")).toBeNull();
  });

  it("does not repeat Direct mock simulation after a successful payment refresh", async () => {
    api.fetch.mockResolvedValue(directSession("Successful"));
    render(<PropertyBookingPaymentEntry sessionCode="BS-PAY-1" kind="mock-payment" directProperty={directProperty} />);
    await vi.waitFor(() => expect(navigation.router.replace).toHaveBeenCalledWith("/book/kashan/reservations/BS-PAY-1/success"));
    expect(screen.queryByRole("button", { name: "پرداخت موفق آزمایشی" })).toBeNull();
    expect(api.simulate).not.toHaveBeenCalled();
  });

  it("Direct mock return ignores arbitrary redirect destinations and reuses existing simulation", async () => {
    api.fetch.mockResolvedValue(directSession());
    api.simulate.mockResolvedValue({ state: "failed", redirectDestination: "https://untrusted.example/" });
    render(<PropertyBookingPaymentEntry sessionCode="BS-PAY-1" kind="mock-payment" directProperty={directProperty} />);
    fireEvent.click(await screen.findByRole("button", { name: "شکست پرداخت آزمایشی" }));
    await vi.waitFor(() => expect(navigation.router.push).toHaveBeenCalledWith("/book/kashan/reservations/BS-PAY-1/payment-failure"));
    expect(api.simulate).toHaveBeenCalledExactlyOnceWith("BS-PAY-1", false);
    expect(api.initiate).not.toHaveBeenCalled();
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

  it("completes test success through the existing server simulation and success route", async () => {
    api.simulate.mockResolvedValue({ state: "applied", redirectDestination: "/booking/sessions/BS-PAY-1/success" });
    render(<MockPaymentCheckout sessionCode="BS-PAY-1" />);
    fireEvent.click(await screen.findByRole("button", { name: "پرداخت موفق آزمایشی" }));
    await vi.waitFor(() => expect(navigation.router.push).toHaveBeenCalledWith("/booking/sessions/BS-PAY-1/success"));
    expect(api.simulate).toHaveBeenCalledWith("BS-PAY-1", true);
    expect(api.initiate).not.toHaveBeenCalled();
  });

  it("does not expose test controls when the server catalog omits the test provider", async () => {
    api.fetchProviders.mockResolvedValue([]);
    render(<MockPaymentCheckout sessionCode="BS-PAY-1" />);
    expect(await screen.findByText(/روش پرداخت فعالی در دسترس نیست/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /پرداخت.*آزمایشی/ })).toBeNull();
    expect(api.simulate).not.toHaveBeenCalled();
  });

  it("prevents duplicate and opposite-result submissions while processing", async () => {
    api.simulate.mockImplementation(() => new Promise(() => {}));
    render(<MockPaymentCheckout sessionCode="BS-PAY-1" />);
    const success = await screen.findByRole("button", { name: "پرداخت موفق آزمایشی" });
    const failure = screen.getByRole("button", { name: "شکست پرداخت آزمایشی" });
    fireEvent.click(success);
    fireEvent.click(success);
    fireEvent.click(failure);
    expect(api.simulate).toHaveBeenCalledOnce();
    expect((success as HTMLButtonElement).disabled).toBe(true);
    expect((failure as HTMLButtonElement).disabled).toBe(true);
  });

  it("shows the server error while retaining retry controls and session data", async () => {
    api.simulate.mockRejectedValueOnce(new Error("پرداخت آزمایشی قابل اعمال نیست"));
    render(<MockPaymentCheckout sessionCode="BS-PAY-1" />);
    fireEvent.click(await screen.findByRole("button", { name: "پرداخت موفق آزمایشی" }));
    expect(await screen.findByText("پرداخت آزمایشی قابل اعمال نیست")).toBeTruthy();
    expect(screen.getByText("BS-PAY-1")).toBeTruthy();
    const retry = screen.getByRole("button", { name: "پرداخت موفق آزمایشی" });
    expect((retry as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(retry);
    await vi.waitFor(() => expect(api.simulate).toHaveBeenCalledTimes(2));
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
