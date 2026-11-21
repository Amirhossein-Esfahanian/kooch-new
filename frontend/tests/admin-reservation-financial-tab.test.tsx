import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";
import { ReservationDetailsDialog, type AdminManualPayment } from "@/components/reservations/ReservationDetailsDialog";
import type { ReservationCancellationFinancialState, ReservationTableItem } from "@/components/reservations/ReservationTable";

vi.mock("@/lib/currency", async original => ({
  ...(await original<typeof import("@/lib/currency")>()), useSiteCurrencyLabel: () => "ریال",
}));

const item: ReservationTableItem = {
  id: 37, reservationNumber: "R-TEST-37", source: "AdminCreated", propertyName: "اقامتگاه آزمون", guestName: "مهمان آزمون",
  checkInDate: "2030-02-01", checkOutDate: "2030-02-03", status: "ApprovedAwaitingPayment", currency: "IRR",
  finalAmount: 1000, paidAmount: 400, remainingAmount: 600, payableAmount: 1000,
  paymentExpiresAtUtc: "2099-01-01T00:00:00Z", remainingPaymentSeconds: 3600, isPaymentExpired: false,
};
const financial: ReservationCancellationFinancialState = {
  paidCancellation: true, grossPaidAmount: 1000, currency: "IRR", mode: "ManualFundingV2", guestRefundAmount: 400,
  guestWalletRestoreAmount: 300, cashRefundExecutedAmount: 0, cashRefundPendingAmount: 400,
  finalPropertyShare: 100, finalKoochShare: 100, forfeitedAmount: 100,
  refundPending: true, alreadyHandledByLegacyRefundV1: false,
  funding: {
    externalAmount: 600, walletAmount: 400, withdrawableWalletAmount: 0, nonWithdrawableWalletAmount: 400,
    sources: [{ sourceToken: "opaque-source", sourceType: "PromotionalCredit", fundedAmount: 400, withdrawable: false,
      expiresAtUtc: null, expired: false, maxCashRefundAmount: 0, maxWalletRestoreAmount: 400,
      remainingDispositionAmount: 0, reference: null, reason: null, paymentStatus: null, paymentMethod: null,
      cashRefundAmount: 0, walletRestoreAmount: 300, notReturnedAmount: 100, cashRefundExecutedAmount: 0 }],
  },
};
const payment: AdminManualPayment = {
  paymentId: 7, reservationId: 37, amount: 400, currency: "IRR", method: "BankTransfer", paymentDate: "2030-01-02",
  paymentTime: null, referenceNumber: "REF-7", destinationBank: "بانک آزمون", destinationAccountReference: "****1234",
  notes: "یادداشت رسید", status: "Successful", verificationStatus: "Approved", submittedBy: "ثبت‌کننده آزمون",
  submittedAtUtc: "2030-01-02T10:00:00Z", verifiedBy: "بررسی‌کننده آزمون", verifiedAtUtc: "2030-01-02T11:00:00Z",
};
function show(props: Partial<ComponentProps<typeof ReservationDetailsDialog>> = {}) {
  render(<ReservationDetailsDialog presentation="page" open onOpenChange={vi.fn()} reservation={item} {...props} />);
  fireEvent.click(screen.getByRole("tab", { name: "پرداخت و بازپرداخت" }));
  return screen.getByRole("region", { name: "خلاصه مالی این رزرو" });
}
function amount(root: HTMLElement, label: string) {
  return within(root).getByText(label, { exact: true }).closest("div")!.querySelector("dd")?.textContent;
}
function expandBreakdown() { fireEvent.click(screen.getByText("ریز محاسبات رزرو و لغو", { selector: "summary" })); }

describe("dedicated Admin financial presentation", () => {
  it("distinguishes received funds and collectible balance, without duplicating the header payment action", () => {
    const summary = show({ onCreateManualPayment: vi.fn() });
    expect(amount(summary, "مبلغ این رزرو")).toBe("۱٬۰۰۰ ریال");
    expect(amount(summary, "وجه دریافت‌شده")).toBe("۴۰۰ ریال");
    expect(amount(summary, "ماندهٔ قابل وصول")).toBe("۶۰۰ ریال");
    expect(screen.getAllByRole("button", { name: "ثبت دریافت برای این رزرو" })).toHaveLength(1);
    expect(screen.getByRole("heading", { name: "مهلت پرداخت" })).toBeTruthy();
    expect(screen.getByText("ریز محاسبات رزرو و لغو", { selector: "summary" }).closest("details")?.open).toBe(false);
  });

  it("does not imply that Pending balances or expired deadlines are actionable", () => {
    const summary = show({ onCreateManualPayment: vi.fn(), reservation: {
      ...item, status: "Pending", canPrepareManualPayment: false,
    } });
    expect(amount(summary, "ماندهٔ ثبت‌شده")).toBe("۶۰۰ ریال");
    expect(within(summary).queryByText("ماندهٔ قابل وصول")).toBeNull();
    expect(screen.getByRole("heading", { name: "مهلت پرداخت" }).closest("details")?.open).toBe(false);
    expandBreakdown();
    expect(screen.getByRole("heading", { name: "مهلت پرداخت" })).toBeTruthy();
  });

  it("keeps unknown amounts distinct from zero, and equal amounts semantically separate in the breakdown", () => {
    const summary = show({ reservation: { ...item, finalAmount: undefined, totalPrice: undefined,
      paidAmount: undefined, baseAmount: 0, calculatedPrice: 1000, discountAmount: 1000, couponDiscountAmount: undefined } });
    expect(amount(summary, "مبلغ این رزرو")).toBe("نامشخص");
    expect(amount(summary, "وجه دریافت‌شده")).toBe("نامشخص");
    expandBreakdown();
    const breakdown = screen.getByRole("region", { name: "محاسبات این رزرو" });
    expect(amount(breakdown, "قیمت پایه")).toBe("۰ ریال");
    expect(amount(breakdown, "تخفیف کوپن")).toBe("نامشخص");
    expect(amount(breakdown, "اصلاح دستی")).toBe("نامشخص");
    expect(amount(breakdown, "مالیات")).toBe("نامشخص");
    expect(amount(breakdown, "قیمت محاسبه‌شده")).toBe("۱٬۰۰۰ ریال");
    expect(amount(breakdown, "تخفیف پروموشن")).toBe("۱٬۰۰۰ ریال");
    expect(amount(breakdown, "مبلغ نهایی رزرو")).toBe("نامشخص");
  });

  it("shows mixed-funding cancellation history and places the authorized refund action beside pending cash", async () => {
    const summary = show({ onRefund: vi.fn(), reservation: { ...item, status: "Cancelled", cancellationFinancial: financial } });
    expect(amount(summary, "وجه دریافت‌شده (سابقه)")).toBe("۱٬۰۰۰ ریال");
    expect(amount(summary, "بازپرداخت نقدی انجام‌شده")).toBe("۰ ریال");
    expect(amount(summary, "بازگردانی به منابع اصلی کیف پول")).toBe("۳۰۰ ریال");
    const pending = within(summary).getByText("بازپرداخت نقدی در انتظار انجام").parentElement!.parentElement!;
    expect(within(pending).getByText("۴۰۰ ریال")).toBeTruthy();
    const refund = within(pending).getByRole("button", { name: "ثبت بازپرداخت" });
    expect(screen.getAllByRole("button", { name: "ثبت بازپرداخت" })).toHaveLength(1);
    expect(screen.queryByText("ماندهٔ قابل وصول")).toBeNull();
    expect(screen.getByRole("heading", { name: "تسویه مالی لغو رزرو" }).closest("details")?.open).toBe(false);
    fireEvent.click(refund);
    const dialog = await screen.findByRole("dialog", { name: "ثبت بازپرداخت" });
    fireEvent.click(within(dialog).getByRole("button", { name: "انصراف" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expandBreakdown();
    expect(screen.getByRole("region", { name: "تصمیم نهایی منابع پرداخت" })).toBeTruthy();
    expect(screen.getByText("سهم نهایی اقامتگاه")).toBeTruthy();
    expect(screen.getByText("ماندهٔ ثبت‌شده (سابقه)")).toBeTruthy();
  });

  it.each([
    { executed: 400, allocated: 400, pending: 0, status: "بازپرداخت نقدی ثبت شده است." },
    { executed: undefined, allocated: 400, pending: undefined, status: "وضعیت اجرای بازپرداخت در دسترس نیست." },
    { executed: 0, allocated: 0, pending: 0, status: "بازپرداخت نقدی لازم نیست." },
  ])("does not turn an allocated cash refund into an executed one ($status)", ({ executed, allocated, pending, status }) => {
    const summary = show({ onRefund: vi.fn(), reservation: { ...item, status: "Cancelled", cancellationFinancial: {
      ...financial, guestRefundAmount: allocated, refundPending: false, cashRefundExecutedAmount: executed, cashRefundPendingAmount: pending,
    } } });
    expect(within(summary).getByText(status)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "ثبت بازپرداخت" })).toBeNull();
    if (executed === undefined) expect(within(summary).queryByText("بازپرداخت نقدی انجام‌شده")).toBeNull();
    else expect(amount(summary, "بازپرداخت نقدی انجام‌شده")).toBe(`${executed === 400 ? "۴۰۰" : "۰"} ریال`);
  });

  it("shows an unknown pending refund amount rather than guessing it from the allocated refund", () => {
    const summary = show({ reservation: { ...item, status: "Cancelled", cancellationFinancial: {
      ...financial, cashRefundPendingAmount: undefined,
    } } });
    const pending = within(summary).getByText("بازپرداخت نقدی در انتظار انجام").parentElement!;
    expect(within(pending).getByText("نامشخص")).toBeTruthy();
    expect(within(pending).queryByText("۴۰۰ ریال")).toBeNull();
    expect(screen.queryByRole("button", { name: "ثبت بازپرداخت" })).toBeNull();
  });

  it("renders compact payment rows, preserves masked metadata and distinguishes workflow from transaction status", () => {
    show({ manualPayments: [payment] });
    const row = screen.getByRole("article", { name: "پرداخت ۷" });
    expect(within(row).getAllByText("۴۰۰ ریال")).toHaveLength(1);
    expect(within(row).queryByText("IRR")).toBeNull();
    expect(within(row).getByText("واریز بانکی")).toBeTruthy();
    expect(within(row).getByText("REF-7")).toBeTruthy();
    const details = within(row).getByText("جزئیات پرداخت", { selector: "summary" }).closest("details")!;
    expect(details.open).toBe(false);
    fireEvent.click(within(row).getByText("جزئیات پرداخت", { selector: "summary" }));
    expect(details.open).toBe(true);
    expect(amount(details, "وضعیت تراکنش")).toBe("موفق");
    expect(amount(details, "وضعیت بررسی")).toBe("تأیید شده");
    expect(amount(details, "بانک مقصد")).toBe("بانک آزمون");
    expect(amount(details, "شناسه حساب مقصد")).toBe("****1234");
    expect(amount(details, "یادداشت")).toBe("یادداشت رسید");
    expect(amount(details, "ثبت‌کننده")).toBe("ثبت‌کننده آزمون");
    expect(amount(details, "تأییدکننده")).toBe("بررسی‌کننده آزمون");
    expect(within(details).queryByText("ردکننده")).toBeNull();
    expect(within(details).queryByText("-", { exact: true })).toBeNull();
  });

  it("uses each payment's actual currency and omits empty optional values", () => {
    show({ manualPayments: [{ ...payment, currency: "USD", referenceNumber: null, destinationBank: " ", notes: null,
      destinationAccountReference: null, verifiedBy: null, verifiedAtUtc: null, submittedBy: null, submittedAtUtc: "" }] });
    const row = screen.getByRole("article", { name: "پرداخت ۷" });
    expect(within(row).getByText("۴۰۰ USD")).toBeTruthy();
    fireEvent.click(within(row).getByText("جزئیات پرداخت", { selector: "summary" }));
    expect(within(row).queryByText(/شماره پیگیری|بانک مقصد|شناسه حساب مقصد|یادداشت|ثبت‌کننده|تأییدکننده/)).toBeNull();
    expect(within(row).queryByText(/ریال/)).toBeNull();
  });

  it("keeps approval behind the existing confirmation and hides write actions without handlers", async () => {
    const approve = vi.fn().mockResolvedValue(undefined);
    show({ onApproveManualPayment: approve, manualPayments: [{ ...payment, status: "Pending", verificationStatus: "PendingVerification" }] });
    fireEvent.click(screen.getByRole("button", { name: "تأیید پرداخت" }));
    expect(approve).not.toHaveBeenCalled();
    const dialog = await screen.findByRole("alertdialog", { name: "تأیید پرداخت دستی" });
    fireEvent.click(within(dialog).getByRole("button", { name: "تأیید پرداخت" }));
    await waitFor(() => expect(approve).toHaveBeenCalledExactlyOnceWith(7));
    expect(screen.queryByRole("button", { name: "رد پرداخت" })).toBeNull();
  });
});
