import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

const mocks = vi.hoisted(() => ({
  request: vi.fn(), id: "37", query: "", router: { push: vi.fn(), replace: vi.fn() },
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
  session: { platformRole: "SuperAdmin", platformPermissions: [] as string[], propertyMemberships: [], authenticated: true, loading: false, workspaces: ["admin"] },
}));
vi.mock("next/navigation", () => ({ useParams: () => ({ reservationId: mocks.id }), useRouter: () => mocks.router, useSearchParams: () => new URLSearchParams(mocks.query) }));
vi.mock("@/components/auth/AuthSessionProvider", () => ({ useAuthSession: () => mocks.session }));
vi.mock("@/components/dashboard/DashboardLayouts", () => ({ AdminLayout: ({ children }: { children: ReactNode }) => <div data-testid="admin-shell">{children}</div> }));
vi.mock("@/components/reservations/ManualReservationDialog", () => ({ ManualReservationDialog: () => null }));
vi.mock("@/components/reservations/vouchers/AdminVoucherView", () => ({ AdminVoucherView: () => <p>ووچر آزمون</p> }));
vi.mock("@/lib/owner-api", async original => ({ ...(await original<typeof import("@/lib/owner-api")>()), apiRequest: mocks.request }));
vi.mock("@/lib/currency", async original => ({ ...(await original<typeof import("@/lib/currency")>()), useSiteCurrencyLabel: () => "ریال" }));
vi.mock("sonner", () => ({ toast: mocks.toast }));

import DetailsPage from "@/app/admin/reservations/[reservationId]/page";
import VoucherPage from "@/app/admin/reservations/[reservationId]/voucher/page";
import { ApiRequestError } from "@/lib/owner-api";

const item = { id: 37, reservationNumber: "R-855759", source: "AdminCreated", propertyId: 3, propertyName: "اقامتگاه آزمون",
  status: "Confirmed", checkInDate: "2030-02-01", checkOutDate: "2030-02-03", guestName: "مهمان آزمون",
  allowedStatusTransitions: ["Cancelled"], currency: "IRR", finalAmount: 5_000_000, remainingAmount: 5_000_000 };

describe("dedicated Admin reservation details", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.id = "37"; mocks.query = "";
    mocks.session.authenticated = true; mocks.session.loading = false; mocks.session.workspaces = ["admin"];
    mocks.session.platformRole = "SuperAdmin"; mocks.session.platformPermissions = [];
    mocks.request.mockImplementation(async (path: string) => {
      if (path === "/admin/reservations/37") return item;
      if (path === "/admin/reservations/37/activities" || path === "/admin/manual-payments/reservation/37") return [];
      throw new Error(path);
    });
  });

  it("opens the existing financial tab directly from the review queue and after reload", async () => {
    const origin = "/admin/reservations?propertyId=3&page=4&tab=payments";
    mocks.query = new URLSearchParams({ tab: "financial", returnTo: origin }).toString();
    const view = render(<DetailsPage />);
    await screen.findByRole("heading", { level: 1, name: /R-/ });
    expect(screen.getByRole("tab", { name: "پرداخت و بازپرداخت" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("link", { name: "بازگشت به رزروها" }).getAttribute("href")).toBe(origin);
    view.unmount(); render(<DetailsPage />);
    await screen.findByRole("heading", { level: 1, name: /R-/ });
    expect(screen.getByRole("tab", { name: "پرداخت و بازپرداخت" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("link", { name: "بازگشت به رزروها" }).getAttribute("href")).toBe(origin);
  });

  it.each(["ManualPaymentDeadlineExpired", "ManualPaymentAlreadyReviewed"])("distinguishes manual review conflict %s and refreshes", async code => {
    const message = "مهلت حفاظت بررسی رسید پایان یافته است.";
    mocks.request.mockImplementation(async (path: string) => {
      if (path === "/admin/reservations/37") return { ...item, status: "ApprovedAwaitingPayment" };
      if (path === "/admin/reservations/37/activities") return [];
      if (path === "/admin/manual-payments/reservation/37") return [{ paymentId: 41, reservationId: 37,
        amount: 5_000_000, currency: "IRR", status: "Pending", verificationStatus: "PendingVerification",
        method: "BankTransfer", paymentDate: "2030-01-01", submittedAtUtc: "2030-01-01T12:00:00Z" }];
      if (path === "/admin/manual-payments/41/approve") throw new ApiRequestError(message, 409, { code });
      throw new Error(path);
    });
    render(<DetailsPage />);
    fireEvent.click(await screen.findByRole("tab", { name: "پرداخت و بازپرداخت" }));
    fireEvent.click(await screen.findByRole("button", { name: "تأیید پرداخت" }));
    const confirmation = await screen.findByRole("alertdialog", { name: "تأیید پرداخت دستی" });
    fireEvent.click(within(confirmation).getByRole("button", { name: "تأیید پرداخت" }));
    if (code === "ManualPaymentDeadlineExpired") {
      await waitFor(() => expect(mocks.toast.error).toHaveBeenCalledWith(message));
      expect(mocks.toast.warning).not.toHaveBeenCalled();
    } else {
      await waitFor(() => expect(mocks.toast.warning).toHaveBeenCalledWith("این پرداخت قبلاً توسط مدیر دیگری بررسی شده است. اطلاعات به‌روز شد."));
      expect(mocks.toast.error).not.toHaveBeenCalled();
    }
    await waitFor(() => expect(mocks.request.mock.calls.filter(([path]) => path === "/admin/reservations/37")).toHaveLength(2));
    expect(mocks.request.mock.calls.filter(([path]) => path === "/admin/manual-payments/41/approve")).toHaveLength(1);
  });

  it("loads from its stable ID on direct entry and reload without loading the list", async () => {
    const page = render(<DetailsPage />);
    await screen.findByRole("heading", { level: 1, name: /R-/ });
    expect(screen.getByTestId("admin-shell")).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getAllByText("تایید شده", { exact: true })).toHaveLength(1);
    expect(screen.getByRole("link", { name: "بازگشت به رزروها" }).getAttribute("href")).toBe("/admin/reservations");
    expect(mocks.request.mock.calls.some(([path]) => String(path).includes("/admin/reservations?"))).toBe(false);
    page.unmount();
    render(<DetailsPage />);
    await screen.findByRole("heading", { level: 1, name: /R-/ });
    expect(mocks.request.mock.calls.filter(([path]) => path === "/admin/reservations/37")).toHaveLength(2);
  });

  it("submits cancellation only after final confirmation and refreshes the real financial outcome and actions", async () => {
    const financial = { paidCancellation: true, grossPaidAmount: 5_000_000, currency: "IRR", mode: null,
      guestRefundAmount: null, finalPropertyShare: null, finalKoochShare: null,
      refundPending: false, alreadyHandledByLegacyRefundV1: false };
    let current: Record<string, unknown> = { ...item, cancellationFinancial: financial };
    mocks.request.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === "/admin/reservations/37/cancel" && init?.method === "PUT") {
        current = { ...item, status: "Cancelled", allowedStatusTransitions: [], cancellationFinancial: {
          ...financial, mode: "AutomaticFullRefundV1", guestRefundAmount: 5_000_000,
          finalPropertyShare: 0, finalKoochShare: 0, refundPending: true,
          cashRefundPendingAmount: 5_000_000, cashRefundExecutedAmount: 0,
        } };
        return { ...current, cancellationOutcome: { paidCancellation: true, refundPending: true } };
      }
      if (path === "/admin/reservations/37") return current;
      if (path === "/admin/reservations/37/activities" || path === "/admin/manual-payments/reservation/37") return [];
      throw new Error(path);
    });
    render(<DetailsPage />);
    fireEvent.click(await screen.findByText("اقدامات بیشتر", { selector: "summary" }));
    fireEvent.click(await screen.findByRole("button", { name: "لغو رزرو" }));
    const dialog = await screen.findByRole("dialog", { name: "لغو رزرو R-855759" });
    fireEvent.change(within(dialog).getByLabelText(/دلیل لغو/), { target: { value: "GuestRequest" } });
    fireEvent.change(within(dialog).getByLabelText(/توضیحات لغو/), { target: { value: "درخواست مهمان" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "تأیید و لغو رزرو" }));
    expect(mocks.request.mock.calls.filter(([, init]) => init?.method === "PUT")).toHaveLength(0);
    const confirmation = screen.getByRole("dialog", { name: "تأیید نهایی لغو رزرو" });
    fireEvent.click(within(confirmation).getByRole("button", { name: "لغو قطعی رزرو" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "تأیید نهایی لغو رزرو" })).toBeNull());
    fireEvent.click(screen.getByRole("tab", { name: "پرداخت و بازپرداخت" }));
    expect(within(screen.getByRole("region", { name: "خلاصه مالی این رزرو" })).getByText("بازپرداخت نقدی در انتظار انجام")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "لغو رزرو" })).toBeNull();
    expect(screen.queryByText("بازپرداخت نقدی ثبت شده است.")).toBeNull();
    expect(screen.getByRole("button", { name: "ثبت بازپرداخت" })).toBeTruthy();
    await waitFor(() => expect(mocks.request.mock.calls.filter(([path]) => path === "/admin/reservations/37")).toHaveLength(2));
    expect(mocks.request.mock.calls.filter(([path]) => path === "/admin/manual-payments/reservation/37")).toHaveLength(2);
    const writes = mocks.request.mock.calls.filter(([, init]) => init?.method === "PUT");
    expect(writes).toHaveLength(1);
    expect(JSON.parse(writes[0][1].body)).toEqual({ reason: "GuestRequest", explanation: "درخواست مهمان",
      idempotencyKey: expect.any(String), financialResolution: { mode: "AutomaticFullRefundV1" } });
  });

  it("preserves the list filters and page through a reloadable return link", async () => {
    mocks.query = new URLSearchParams({ returnTo: "/admin/reservations?propertyId=3&status=Confirmed&page=4" }).toString();
    render(<DetailsPage />);
    await screen.findByRole("heading", { level: 1 });
    expect(screen.getByRole("link", { name: "بازگشت به رزروها" }).getAttribute("href"))
      .toBe("/admin/reservations?propertyId=3&status=Confirmed&page=4");
    fireEvent.click(screen.getByRole("button", { name: "مشاهده ووچر" }));
    expect(mocks.router.push).toHaveBeenCalledWith("/admin/reservations/37/voucher?returnTo=%2Fadmin%2Freservations%3FpropertyId%3D3%26status%3DConfirmed%26page%3D4");
  });

  it("cancels task assignment back to the same activity tab and reservation without navigation or a task write", async () => {
    mocks.query = new URLSearchParams({ returnTo: "/admin/reservations?propertyId=3&status=Confirmed&page=4" }).toString();
    mocks.request.mockImplementation(async (path: string) => {
      if (path === "/admin/reservations/37") return item;
      if (path === "/admin/reservations/37/activities" || path === "/admin/manual-payments/reservation/37") return [];
      if (path === "/admin/tasks/assignees") return [{ id: 4, displayName: "مدیر آزمون" }];
      throw new Error(path);
    });
    render(<DetailsPage />);
    await screen.findByRole("heading", { level: 1, name: /R-/ });
    fireEvent.click(screen.getByRole("tab", { name: "فعالیت‌ها و یادداشت‌ها" }));
    fireEvent.click(screen.getByRole("button", { name: "ارجاع کار" }));
    const dialog = await screen.findByRole("dialog", { name: "ایجاد کار" });
    const summary = within(dialog).getByRole("region", { name: "رزرو مرتبط" });
    expect(within(summary).getByText("R-855759")).toBeTruthy();
    expect(within(summary).getByText("اقامتگاه آزمون")).toBeTruthy();
    expect(within(dialog).queryByLabelText("جستجوی رزرو (اختیاری)")).toBeNull();
    fireEvent.click(within(dialog).getByRole("button", { name: "انصراف" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "ایجاد کار" })).toBeNull());
    expect(screen.getByRole("tab", { name: "فعالیت‌ها و یادداشت‌ها" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toContain("R-");
    expect(screen.getByRole("link", { name: "بازگشت به رزروها" }).getAttribute("href")).toBe("/admin/reservations?propertyId=3&status=Confirmed&page=4");
    expect(mocks.router.push).not.toHaveBeenCalled();
    expect(mocks.request.mock.calls.filter(([path]) => path === "/admin/reservations/37")).toHaveLength(1);
    expect(mocks.request.mock.calls.some(([path]) => String(path).startsWith("/admin/reservations?"))).toBe(false);
    expect(mocks.request.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
  });

  it("carries the same safe list return context through the voucher route", () => {
    mocks.query = new URLSearchParams({ returnTo: "/admin/reservations?status=Confirmed&page=4" }).toString();
    render(<VoucherPage />);
    fireEvent.click(screen.getByRole("button", { name: "بازگشت به رزروها" }));
    expect(mocks.router.push).toHaveBeenCalledWith("/admin/reservations?status=Confirmed&page=4");
  });

  it("keeps private contents and write actions absent on a server-side property denial", async () => {
    mocks.request.mockRejectedValue(new Error("private details must not leak"));
    render(<DetailsPage />);
    await screen.findByRole("alert");
    expect(screen.queryByText("مهمان آزمون")).toBeNull();
    expect(screen.queryByText("private details must not leak")).toBeNull();
    expect(screen.queryByRole("button", { name: "لغو رزرو" })).toBeNull();
    expect(screen.queryByRole("button", { name: "ارجاع کار" })).toBeNull();
  });

  it("does not load financial endpoints or offer their actions without ManagePayments", async () => {
    mocks.session.platformRole = "AdminAssistant"; mocks.session.platformPermissions = [];
    render(<DetailsPage />);
    await screen.findByRole("heading", { level: 1, name: /R-/ });
    expect(mocks.request.mock.calls.some(([path]) => String(path).includes("/admin/manual-payments"))).toBe(false);
    expect(screen.queryByRole("button", { name: "مشاهده ووچر" })).toBeNull();
    expect(screen.queryByRole("button", { name: "ارجاع کار" })).toBeNull();
  });

  it("waits for the authenticated Admin workspace and does not request while unauthenticated", () => {
    mocks.session.loading = true;
    const { rerender } = render(<DetailsPage />);
    expect(mocks.request).not.toHaveBeenCalled();
    mocks.session.loading = false; mocks.session.authenticated = false;
    rerender(<DetailsPage />);
    expect(mocks.request).not.toHaveBeenCalled();
  });

  it.each(["abc", "0", "-1", "1.5"])("rejects malformed route ID %s without calling the API", async id => {
    mocks.id = id;
    render(<DetailsPage />);
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", "شناسه رزرو معتبر نیست.");
    expect(mocks.request).not.toHaveBeenCalled();
  });
});
