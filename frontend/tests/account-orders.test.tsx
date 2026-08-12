import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const navigation = vi.hoisted(() => ({
  router: { push: vi.fn(), replace: vi.fn() },
}));
const bookingApi = vi.hoisted(() => ({
  fetchList: vi.fn(),
  initiate: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => navigation.router }));
vi.mock("@/components/auth/AuthSessionProvider", () => ({
  resolveSessionDestination: () => "/",
  useAuthSession: () => ({
    authenticated: true,
    loading: false,
    workspaces: ["account"],
  }),
}));
vi.mock("@/lib/booking-sessions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/booking-sessions")>();
  return {
    ...actual,
    fetchAccountBookingSessions: bookingApi.fetchList,
    initiateAccountBookingSessionPayment: bookingApi.initiate,
  };
});
vi.mock("@/lib/currency", () => ({
  formatCurrency: (value: number) => `${value.toLocaleString("fa-IR")} تومان`,
  useSiteCurrencyLabel: () => "تومان",
}));

import AccountPage from "@/app/account/page";
import AccountOrdersPage from "@/app/account/orders/page";
import { orderStatusLabels } from "@/lib/account-orders";

const readyOrder = {
  sessionCode: "BS-READY-1",
  property: { propertyId: 1, name: "خانه کاشان", slug: "kashan-house" },
  checkInDate: "2030-08-10",
  checkOutDate: "2030-08-12",
  reservationCount: 2,
  totalAmount: 4_000_000,
  currency: "IRR",
  derivedStatus: "ReadyForPayment",
  paymentStatus: "Pending",
  paymentDeadlineUtc: "2099-08-10T10:00:00Z",
  isPaymentReady: true,
};

describe("account orders", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("NEXT_PUBLIC_INTERNAL_TEST_PAYMENTS_ENABLED", "true");
    bookingApi.fetchList.mockResolvedValue({
      items: [
        readyOrder,
        {
          ...readyOrder,
          sessionCode: "BS-REJECTED-2",
          derivedStatus: "Rejected",
          paymentStatus: null,
          paymentDeadlineUtc: null,
          isPaymentReady: false,
        },
      ],
      totalCount: 12,
      page: 1,
      pageSize: 10,
      totalPages: 2,
    });
    bookingApi.initiate.mockResolvedValue({
      paymentId: 10,
      status: "Pending",
      checkoutDestination: "/booking/sessions/BS-READY-1/mock-payment",
    });
  });

  it("provides clear Persian labels for every derived order state", () => {
    expect(orderStatusLabels).toMatchObject({
      AwaitingApproval: "در انتظار تأیید",
      ReadyForPayment: "آماده پرداخت",
      PaymentSuccessful: "پرداخت موفق",
      PaymentFailed: "پرداخت ناموفق",
      Expired: "منقضی",
      Rejected: "ردشده",
      Mixed: "نتیجه ترکیبی",
    });
  });

  it("renders grouped order information, Persian states, and a deadline", async () => {
    render(<AccountOrdersPage />);

    expect(await screen.findByText("BS-READY-1")).toBeTruthy();
    expect(screen.getAllByText("۲ رزرو مستقل")).toHaveLength(2);
    expect(screen.getByText("آماده پرداخت")).toBeTruthy();
    expect(screen.getByText("ردشده")).toBeTruthy();
    expect(screen.getByText("مهلت پرداخت")).toBeTruthy();
    expect(bookingApi.fetchList).toHaveBeenCalledWith(1, 10);
  });

  it("uses backend pagination and routes payment through canonical session details", async () => {
    render(<AccountOrdersPage />);
    const paymentLink = await screen.findByRole("link", { name: "ادامه پرداخت" });
    expect(paymentLink.getAttribute("href")).toBe(
      "/account/booking-sessions/BS-READY-1",
    );
    expect(bookingApi.initiate).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "بعدی" }));
    await waitFor(() => expect(bookingApi.fetchList).toHaveBeenCalledWith(2, 10));
  });

  it("shows a canonical retry link for a failed but still-payable order", async () => {
    bookingApi.fetchList.mockResolvedValue({
      items: [{ ...readyOrder, paymentStatus: "Failed" }],
      totalCount: 1,
      page: 1,
      pageSize: 10,
      totalPages: 1,
    });

    render(<AccountOrdersPage />);

    const retry = await screen.findByRole("link", { name: "تلاش مجدد برای پرداخت" });
    expect(retry.getAttribute("href")).toBe(
      "/account/booking-sessions/BS-READY-1",
    );
  });

  it.each([
    { paymentStatus: "Successful", isPaymentReady: false, paymentDeadlineUtc: null },
    { paymentStatus: "Failed", isPaymentReady: true, paymentDeadlineUtc: "2000-08-10T10:00:00Z" },
    { paymentStatus: null, isPaymentReady: false, paymentDeadlineUtc: null },
  ])("hides retry when the order is not currently payable", async (overrides) => {
    bookingApi.fetchList.mockResolvedValue({
      items: [{ ...readyOrder, ...overrides }],
      totalCount: 1,
      page: 1,
      pageSize: 10,
      totalPages: 1,
    });

    render(<AccountOrdersPage />);

    expect(await screen.findByText("BS-READY-1")).toBeTruthy();
    expect(screen.queryByRole("link", { name: /پرداخت/ })).toBeNull();
  });

  it("does not expose mock payment when its public UI flag is disabled", async () => {
    vi.stubEnv("NEXT_PUBLIC_INTERNAL_TEST_PAYMENTS_ENABLED", "false");
    render(<AccountOrdersPage />);
    expect(await screen.findByText("BS-READY-1")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "ادامه پرداخت" })).toBeNull();
  });

  it("labels a mixed order total as its original amount and defers payment to details", async () => {
    bookingApi.fetchList.mockResolvedValue({
      items: [{ ...readyOrder, derivedStatus: "Mixed", paymentStatus: null }],
      totalCount: 1,
      page: 1,
      pageSize: 10,
      totalPages: 1,
    });

    render(<AccountOrdersPage />);

    expect(await screen.findByText("نتیجه ترکیبی")).toBeTruthy();
    expect(screen.getByText("رزروها و مبلغ اولیه سفارش")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "ادامه پرداخت" })).toBeNull();
  });

  it("keeps grouped orders and legacy independent reservations visibly separate", () => {
    render(<AccountPage />);
    expect(screen.getByRole("link", { name: "مشاهده سفارش‌های من" }).getAttribute("href")).toBe("/account/orders");
    expect(screen.getByRole("link", { name: "مشاهده رزروهای مستقل" }).getAttribute("href")).toBe("/account/reservations");
    expect(screen.getByText(/رزروهای مستقل و قدیمی/)).toBeTruthy();
  });
});
