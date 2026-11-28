import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Page from "@/app/account/reservations/[reservationNumber]/page";
import { type AccountReservation, type GuestManualReceipt, formatDateTime, guestPaymentMessage } from "@/lib/account-reservations";
import { formatCurrency } from "@/lib/currency";

const api = vi.hoisted(() => vi.fn());
vi.mock("@/lib/owner-api", () => ({ apiRequest: api, ApiRequestError: class extends Error {} }));
vi.mock("next/navigation", () => ({
  useParams: () => ({ reservationNumber: "R-1" }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/components/auth/AuthSessionProvider", () => ({
  resolveSessionDestination: () => "/",
  useAuthSession: () => ({ authenticated: true, loading: false, workspaces: ["account"] }),
}));
vi.mock("@/lib/currency", async () => ({
  ...await vi.importActual<typeof import("@/lib/currency")>("@/lib/currency"),
  useSiteCurrencyLabel: () => "عنوان فعلی",
}));

const base = (): AccountReservation => ({
  reservationId: 1, reservationNumber: "R-1", propertyName: "اقامتگاه آزمایش", roomTypeName: "دبل",
  checkInDate: "2030-10-01", checkOutDate: "2030-10-02", nightsCount: 1, adults: 1, children: 0, roomCount: 1,
  finalAmount: 1000, totalPrice: 1000, paidAmount: 1000, remainingAmount: 0,
  currency: "IRR", currencyLabel: "عنوان زمان رزرو", status: "Confirmed", isPaymentEligible: false,
  guestPaymentSummary: { confirmedPaidAmount: 1000, pendingReviewAmount: 0, unpaidAmount: 0, collectibleAmount: 0,
    usesOrderPayment: false, canPayOrder: false, manualReceipts: [] },
});
const receipt = (status: GuestManualReceipt["verificationStatus"] = "PendingVerification"): GuestManualReceipt => ({
  amount: 700, currencyLabel: "عنوان زمان رزرو", method: "BankTransfer", reference: "…1234",
  registeredAtUtc: "2026-11-20T08:00:00Z", verificationStatus: status,
  hasActiveReviewProtection: false, reviewProtectionExpiresAtUtc: null,
});
function respond(data: AccountReservation) {
  api.mockImplementation(async (path: string) => {
    if (path.endsWith("/cashback")) return { cashback: null };
    if (path.endsWith("/cancellation-request")) return null;
    return data;
  });
}
beforeEach(() => { api.mockReset(); });

describe("Guest reservation financial read model presentation", () => {
  it("shows confirmed paid, pending review, unpaid and collectible as separate server values with the saved title", async () => {
    const data = base();
    data.status = "ApprovedAwaitingPayment";
    data.paymentExpiresAtUtc = "2030-10-01T12:00:00Z";
    data.paidAmount = 300;
    data.remainingAmount = 700;
    data.guestPaymentSummary = { confirmedPaidAmount: 300, pendingReviewAmount: 700, unpaidAmount: 700, collectibleAmount: 700,
      usesOrderPayment: false, canPayOrder: false, manualReceipts: [receipt()] };
    respond(data);
    render(<Page />);
    const financial = (await screen.findByRole("heading", { name: "مالی" })).closest("section")!;
    const paid = within(financial).getByText("پرداخت تأییدشده").parentElement!;
    expect(paid.textContent).toContain(formatCurrency(300, { currencyLabel: data.currencyLabel! }));
    for (const label of ["رسید در انتظار بررسی (تأییدنشده)", "مانده پرداخت‌نشده", "مبلغ قابل پرداخت در حال حاضر"])
      expect(within(financial).getByText(label).parentElement!.textContent).toContain(formatCurrency(700, { currencyLabel: data.currencyLabel! }));
    expect(screen.queryByText(/پرداخت لازم نیست/)).toBeNull();
    expect(screen.queryByText("عنوان فعلی")).toBeNull();
    const receipts = screen.getByRole("region", { name: "رسیدهای پرداخت" });
    expect(within(receipts).getByText("در انتظار بررسی رسید")).toBeTruthy();
    expect(within(receipts).getByText("واریز بانکی")).toBeTruthy();
    expect(within(receipts).getByText("…1234")).toBeTruthy();
    expect(within(receipts).getByText(formatDateTime(receipt().registeredAtUtc))).toBeTruthy();
  });

  it("warns about financial follow-up, not automatic recovery, for an expired reservation with a pending receipt", async () => {
    const data = base(); data.status = "PaymentExpired"; data.paidAmount = 0; data.remainingAmount = 1000;
    data.guestPaymentSummary = { ...data.guestPaymentSummary!, confirmedPaidAmount: 0, unpaidAmount: 1000, pendingReviewAmount: 700, manualReceipts: [receipt()] };
    respond(data); render(<Page />);
    await screen.findByRole("heading", { name: "مالی" });
    expect(screen.getAllByText(/پیگیری مالی لازم است؛ بررسی رسید، رزرو را خودکار بازنمی‌گرداند/).length).toBeGreaterThan(0);
    expect(screen.getByText("مانده تاریخی (غیرقابل پرداخت)")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "ادامه پرداخت" })).toBeNull();
    // Existing cancellation-request policy is deliberately not changed in Phase A.
    expect(await screen.findByRole("button", { name: "درخواست لغو رزرو" })).toBeTruthy();
  });

  it("shows the server's active review expiry without extending the displayed payment deadline", async () => {
    const data = base(); data.status = "ApprovedAwaitingPayment"; data.paymentExpiresAtUtc = "2030-10-01T12:00:00Z";
    const protectedReceipt = { ...receipt(), hasActiveReviewProtection: true, reviewProtectionExpiresAtUtc: "2030-10-02T12:00:00Z" };
    data.guestPaymentSummary!.manualReceipts = [protectedReceipt];
    respond(data); render(<Page />);
    await screen.findByText(/حفاظت موقت رزرو در زمان بررسی رسید تا/);
    expect(screen.getByText(/مهلت اصلی پرداخت تغییر نکرده است/).textContent).toContain(formatDateTime(protectedReceipt.reviewProtectionExpiresAtUtc));
    expect(screen.getByText(formatDateTime(data.paymentExpiresAtUtc))).toBeTruthy();
  });

  it("keeps authorized order members separate and never treats an incomplete list as a complete order", async () => {
    const data = base();
    data.guestOrder = { orderCode: "O-100", includesAllReservations: false, reservations: [
      { reservationNumber: "R-1", roomTypeName: "دبل", status: "Confirmed" },
      { reservationNumber: "R-2", roomTypeName: "تویین", status: "PendingApproval" },
    ] };
    respond(data); render(<Page />);
    await screen.findByRole("heading", { name: "سفارش O-100" });
    expect(screen.getByText(/این فهرست تمام اعضای سفارش نیست/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "R-2" }).getAttribute("href")).toBe("/account/reservations/R-2");
    expect(screen.queryByRole("link", { name: "بررسی پرداخت سفارش" })).toBeNull();
  });

  it.each([
    ["Confirmed", "Approved", "به‌طور کامل پرداخت شده"],
    ["ApprovedAwaitingPayment", null, "در انتظار پرداخت"],
    ["PendingApproval", null, "در انتظار تأیید اقامتگاه"],
    ["Pending", null, "در انتظار بررسی و آماده‌سازی"],
    ["Expired", null, "رزرو منقضی شده"],
    ["Cancelled", null, "رزرو لغو شده"],
    ["ApprovedAwaitingPayment", "Rejected", "رسید پرداخت رد شده"],
  ] as const)("describes %s / %s without the generic no-payment fallback", (status, verification, text) => {
    const data = base(); data.status = status;
    if (verification) data.guestPaymentSummary!.manualReceipts = [receipt(verification)];
    expect(guestPaymentMessage(data)).toContain(text);
    expect(guestPaymentMessage(data)).not.toContain("پرداخت لازم نیست");
  });
});
