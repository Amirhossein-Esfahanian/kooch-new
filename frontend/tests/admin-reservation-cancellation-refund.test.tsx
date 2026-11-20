import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ReservationDetailsDialog } from "@/components/reservations/ReservationDetailsDialog";
import { ApiRequestError } from "@/lib/owner-api";
import type { ReservationTableItem } from "@/components/reservations/ReservationTable";

vi.mock("@/lib/currency", () => ({
  formatCurrency: (value?: number | null) => `${value ?? 0} واحد`,
  useSiteCurrencyLabel: () => "واحد",
}));

vi.mock("@/components/KoochDatePicker", () => ({
  KoochDatePicker: ({ value, onChange }: { value: string | null; onChange: (value: string | null) => void }) => (
    <input type="date" value={value ?? ""} onChange={(event) => onChange(event.target.value || null)} />
  ),
}));

const financial = {
  paidCancellation: true,
  grossPaidAmount: 1000,
  currency: "IRR",
  mode: null,
  guestRefundAmount: null,
  finalPropertyShare: null,
  finalKoochShare: null,
  refundPending: false,
  alreadyHandledByLegacyRefundV1: false,
} as const;

const funding = {
  externalAmount: 400, walletAmount: 600, withdrawableWalletAmount: 300, nonWithdrawableWalletAmount: 300,
  sources: [
    { sourceToken: "external-handle", sourceType: "ExternalPayment", fundedAmount: 400, withdrawable: true,
      maxCashRefundAmount: 400, maxWalletRestoreAmount: 0, expiresAtUtc: null, expired: false },
    { sourceToken: "cash-handle", sourceType: "CashReceived", fundedAmount: 300, withdrawable: true,
      maxCashRefundAmount: 300, maxWalletRestoreAmount: 300, expiresAtUtc: null, expired: false },
    { sourceToken: "promo-handle", sourceType: "PromotionalCredit", fundedAmount: 300, withdrawable: false,
      maxCashRefundAmount: 0, maxWalletRestoreAmount: 300, expiresAtUtc: "2020-01-01T00:00:00Z", expired: true },
  ].map((s) => ({ ...s, remainingDispositionAmount: s.fundedAmount, reference: null, reason: null,
    paymentStatus: null, paymentMethod: null, cashRefundAmount: 0, walletRestoreAmount: 0,
    notReturnedAmount: 0, cashRefundExecutedAmount: 0 })),
};

function fillFundingSplit() {
  const groups = within(screen.getByRole("region", { name: "تسویه مالی لغو رزرو" })).getAllByRole("group");
  const change = (root: HTMLElement, label: string, value: string) => fireEvent.change(within(root).getByLabelText(label, { exact: false }), { target: { value } });
  change(groups[0], "بازپرداخت نقدی", "300");
  change(groups[0], "بازگردانده نمی‌شود", "100");
  change(groups[1], "بازپرداخت نقدی", "100");
  change(groups[1], "بازگردانی به منبع اصلی کیف پول", "100");
  change(groups[1], "بازگردانده نمی‌شود", "100");
  change(groups[2], "بازگردانی به منبع اصلی کیف پول", "200");
  change(groups[2], "بازگردانده نمی‌شود", "100");
  change(document.body, "سهم نهایی اقامتگاه", "100");
  change(document.body, "سهم نهایی کوچ", "100");
  change(document.body, "اعتبار/مبلغ سوخت‌شده", "100");
}

describe("Admin funding-aware cancellation V2", () => {
  it("shows reservation and external-only funding without forcing manual allocation", async () => {
    const externalFunding = { externalAmount: 1000, walletAmount: 0,
      withdrawableWalletAmount: 0, nonWithdrawableWalletAmount: 0,
      sources: [{ ...funding.sources[0], fundedAmount: 1000, remainingDispositionAmount: 1000,
        maxCashRefundAmount: 1000 }] };
    const onCancel = vi.fn().mockResolvedValue(undefined);
    renderDialog({ onCancel, reservation: reservation({ cancellationFinancial: {
      ...financial, funding: externalFunding } }) });
    await openCancellation();
    const summary = screen.getByRole("region", { name: "خلاصه رزرو" });
    expect(within(summary).getByText("اقامتگاه آزمون")).toBeTruthy();
    expect(within(summary).getByText("تایید شده")).toBeTruthy();
    expect(within(summary).queryByText("واحد پول")).toBeNull();
    expect(within(summary).getByText("۹۰۰۰ واحد")).toBeTruthy();
    const sources = screen.getByRole("region", { name: "منابع پرداخت" });
    expect(within(sources).getByText("پرداخت خارجی")).toBeTruthy();
    expect(within(sources).getByText(/بازپرداخت نقدی، بازگردانده نمی‌شود/)).toBeTruthy();
    expect(screen.getByRole("checkbox", { name: "می‌خواهم مبالغ را دستی تعیین کنم" })).toBeTruthy();
    fillCancellation();
    confirmCancellation();
    await waitFor(() => expect(onCancel).toHaveBeenCalledOnce());
    expect(onCancel.mock.calls[0][1].financialResolution).toEqual({ mode: "AutomaticFullRefundV1" });
  });

  it("shows wallet-only funding and requires source decisions", async () => {
    const walletFunding = { externalAmount: 0, walletAmount: 1000,
      withdrawableWalletAmount: 500, nonWithdrawableWalletAmount: 500,
      sources: [{ ...funding.sources[1], fundedAmount: 500, remainingDispositionAmount: 500,
        maxCashRefundAmount: 500, maxWalletRestoreAmount: 500 },
      { ...funding.sources[2], fundedAmount: 500, remainingDispositionAmount: 500,
        maxWalletRestoreAmount: 500 }] };
    renderDialog({ onCancel: vi.fn(), reservation: reservation({ cancellationFinancial: {
      ...financial, funding: walletFunding } }) });
    await openCancellation();
    const groups = within(screen.getByRole("region", { name: "تسویه مالی لغو رزرو" })).getAllByRole("group");
    expect(groups).toHaveLength(2);
    expect(within(groups[0]).getByLabelText(/بازپرداخت نقدی/)).toBeTruthy();
    expect(within(groups[0]).getByLabelText(/بازگردانی به منبع اصلی کیف پول/)).toBeTruthy();
    expect(within(groups[1]).queryByLabelText(/بازپرداخت نقدی/)).toBeNull();
    expect((screen.getByRole("button", { name: "تأیید و لغو رزرو" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("renders authoritative funding capabilities and expiry without an automatic wallet decision", async () => {
    renderDialog({ onCancel: vi.fn(), reservation: reservation({ cancellationFinancial: { ...financial, funding } }) });
    await openCancellation();
    expect(screen.queryByRole("checkbox")).toBeNull();
    const groups = within(screen.getByRole("region", { name: "تسویه مالی لغو رزرو" })).getAllByRole("group");
    expect(groups).toHaveLength(3);
    expect(within(groups[0]).queryByLabelText(/بازگردانی به منبع اصلی کیف پول/)).toBeNull();
    expect(within(groups[1]).getByLabelText(/بازپرداخت نقدی/)).toBeTruthy();
    expect(within(groups[1]).getByLabelText(/بازگردانی به منبع اصلی کیف پول/)).toBeTruthy();
    expect(within(groups[2]).queryByLabelText(/بازپرداخت نقدی/)).toBeNull();
    expect(within(groups[2]).getByText(/منقضی شده و قابل استفاده نخواهد بود/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "تأیید و لغو رزرو" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("reconciles live, confirms exact totals and sends only opaque source decisions", async () => {
    const onCancel = vi.fn().mockResolvedValue(undefined);
    renderDialog({ onCancel, reservation: reservation({ cancellationFinancial: { ...financial, funding } }) });
    await openCancellation(); fillCancellation(); fillFundingSplit();
    const confirmation = screen.getByRole("dialog", { name: "لغو رزرو R-123456" });
    expect(within(confirmation).getByRole("region", { name: "پیامدهای لغو" })).toBeTruthy();
    expect(within(confirmation).getAllByText("۴۰۰ واحد").length).toBeGreaterThan(0);
    expect(within(confirmation).getAllByText("۳۰۰ واحد").length).toBeGreaterThan(0);
    expect(within(confirmation).getAllByText("بازگردانده نمی‌شود").length).toBeGreaterThan(0);
    expect(onCancel).not.toHaveBeenCalled();
    confirmCancellation();
    await waitFor(() => expect(onCancel).toHaveBeenCalledOnce());
    expect(onCancel.mock.calls[0][1].financialResolution).toEqual({
      mode: "ManualFundingV2", finalPropertyShare: 100, finalKoochShare: 100, forfeitedAmount: 100,
      sourceDispositions: [
        { sourceToken: "external-handle", cashRefundAmount: 300, walletRestoreAmount: 0, notReturnedAmount: 100 },
        { sourceToken: "cash-handle", cashRefundAmount: 100, walletRestoreAmount: 100, notReturnedAmount: 100 },
        { sourceToken: "promo-handle", cashRefundAmount: 0, walletRestoreAmount: 200, notReturnedAmount: 100 },
      ],
    });
  });

  it.each(["sum", "source", "negative", "precision"])("blocks an invalid %s decision", async (kind) => {
    const onCancel = vi.fn();
    renderDialog({ onCancel, reservation: reservation({ cancellationFinancial: { ...financial, funding } }) });
    await openCancellation(); fillCancellation(); fillFundingSplit();
    if (kind === "sum") fireEvent.change(screen.getByLabelText(/سهم نهایی کوچ/), { target: { value: "101" } });
    else fireEvent.change(within(within(screen.getByRole("region", { name: "تسویه مالی لغو رزرو" })).getAllByRole("group")[0]).getByLabelText(/بازپرداخت نقدی/),
      { target: { value: kind === "source" ? "299" : kind === "negative" ? "-1" : "299.999" } });
    expect((screen.getByRole("button", { name: "تأیید و لغو رزرو" }) as HTMLButtonElement).disabled).toBe(true);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("shows finalized V2 cash status read-only and retains pending refund action", async () => {
    const finalizedFunding = { ...funding, sources: funding.sources.map((source, index) => ({
      ...source, cashRefundAmount: index === 0 ? 300 : index === 1 ? 100 : 0,
      walletRestoreAmount: index === 1 ? 100 : index === 2 ? 200 : 0,
      notReturnedAmount: 100,
    })) };
    renderDialog({ onCancel: vi.fn(), onRefund: vi.fn(), reservation: reservation({ status: "Cancelled",
      cancellationFinancial: { ...financial, funding: finalizedFunding, mode: "ManualFundingV2", guestRefundAmount: 400,
        guestWalletRestoreAmount: 300, forfeitedAmount: 100, finalPropertyShare: 100, finalKoochShare: 100,
        cashRefundExecutedAmount: 0, cashRefundPendingAmount: 400, refundPending: true } }) });
    expect(await screen.findByRole("button", { name: "ثبت بازپرداخت" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "لغو رزرو" })).toBeNull();
    expect(screen.getByText("مبلغ بازپرداخت نقدی در انتظار انجام")).toBeTruthy();
    const decisions = screen.getByRole("region", { name: "تصمیم نهایی منابع پرداخت" });
    expect(within(decisions).getAllByText(/بازپرداخت نقدی:/)).toHaveLength(3);
    expect(within(decisions).getAllByText(/بازگردانی به منبع اصلی کیف پول:/)).toHaveLength(3);
    expect(within(decisions).queryByRole("textbox")).toBeNull();
  });
});

function reservation(overrides: Partial<ReservationTableItem> = {}): ReservationTableItem {
  return {
    id: 12,
    reservationNumber: "R-123456",
    propertyId: 2,
    propertyName: "اقامتگاه آزمون",
    roomTypeId: 3,
    roomTypeName: "اتاق",
    guestId: 4,
    guestName: "مهمان آزمون",
    checkInDate: "2026-09-01",
    checkOutDate: "2026-09-03",
    adults: 2,
    children: 0,
    status: "Confirmed",
    finalAmount: 9000,
    paidAmount: 8000,
    allowedStatusTransitions: ["Cancelled"],
    cancellationFinancial: { ...financial },
    ...overrides,
  };
}

function renderDialog(props: Partial<ComponentProps<typeof ReservationDetailsDialog>> = {}) {
  return render(<ReservationDetailsDialog onOpenChange={vi.fn()} open
    reservation={reservation()} {...props} />);
}

async function openCancellation() {
  fireEvent.click(await screen.findByRole("button", { name: "لغو رزرو" }));
  await screen.findByRole("dialog", { name: "لغو رزرو R-123456" });
}

function fillCancellation() {
  fireEvent.change(screen.getByLabelText(/دلیل لغو/), { target: { value: "GuestRequest" } });
  fireEvent.change(screen.getByLabelText(/توضیحات لغو/), { target: { value: "درخواست مهمان" } });
}

function confirmCancellation() {
  fireEvent.click(screen.getByRole("button", { name: "تأیید و لغو رزرو" }));
  fireEvent.click(screen.getByRole("button", { name: "لغو قطعی رزرو" }));
}

function setManualSplit(guest: string, property: string, kooch: string) {
  fireEvent.click(screen.getByRole("checkbox", { name: "می‌خواهم مبالغ را دستی تعیین کنم" }));
  fireEvent.change(screen.getByLabelText(/مبلغ بازپرداخت به مهمان/), { target: { value: guest } });
  fireEvent.change(screen.getByLabelText(/سهم نهایی اقامتگاه/), { target: { value: property } });
  fireEvent.change(screen.getByLabelText(/سهم نهایی کوچ/), { target: { value: kooch } });
}

describe("Admin reservation cancellation financial UI", () => {
  beforeEach(() => {
    let key = 0;
    vi.stubGlobal("crypto", { randomUUID: () => `operation-${++key}` });
  });
  afterEach(() => vi.unstubAllGlobals());

  it.each(["back", "Escape", "close", "backdrop"])("dismisses final confirmation using %s without submitting or losing the allocation", async method => {
    const onCancel = vi.fn().mockResolvedValue(undefined);
    renderDialog({ presentation: "page", onCancel });
    await openCancellation();
    fillCancellation(); setManualSplit("500", "300", "200");
    fireEvent.change(screen.getByLabelText("یادداشت تصمیم مالی (اختیاری)"), { target: { value: "تصمیم مدیر" } });
    const review = screen.getByRole("button", { name: "تأیید و لغو رزرو" });
    fireEvent.click(review);
    fireEvent.click(review);
    const confirmation = screen.getByRole("dialog", { name: "تأیید نهایی لغو رزرو" });
    expect(confirmation.getAttribute("aria-modal")).toBe("true");
    expect(within(confirmation).getByText("لغو رزرو قابل بازگشت نیست")).toBeTruthy();
    expect(onCancel).not.toHaveBeenCalled();
    await waitFor(() => expect(document.activeElement).toBe(within(confirmation).getByRole("button", { name: "بازگشت به فرم" })));
    if (method === "Escape") fireEvent.keyDown(document, { key: "Escape" });
    else if (method === "backdrop") fireEvent.click(within(confirmation.closest('[data-slot="dialog-root"]') as HTMLElement).getByRole("button", { name: "بستن دیالوگ" }));
    else fireEvent.click(within(confirmation).getByRole("button", { name: method === "back" ? "بازگشت به فرم" : "بستن" }));
    expect(screen.getByLabelText(/دلیل لغو/)).toHaveProperty("value", "GuestRequest");
    expect(screen.getByLabelText(/توضیحات لغو/)).toHaveProperty("value", "درخواست مهمان");
    expect(screen.getByLabelText(/مبلغ بازپرداخت به مهمان/)).toHaveProperty("value", "500");
    expect(screen.getByLabelText("یادداشت تصمیم مالی (اختیاری)")).toHaveProperty("value", "تصمیم مدیر");
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "تأیید و لغو رزرو" })));
    expect(onCancel).not.toHaveBeenCalled();
    confirmCancellation();
    await waitFor(() => expect(onCancel).toHaveBeenCalledOnce());
  });

  it("submits wallet-only restoration to original funding sources without cash conversion", async () => {
    const walletFunding = { ...funding, externalAmount: 0, walletAmount: 1000,
      sources: [
        { ...funding.sources[1], fundedAmount: 400, maxCashRefundAmount: 400, maxWalletRestoreAmount: 400 },
        { ...funding.sources[2], fundedAmount: 600, maxWalletRestoreAmount: 600 },
      ] };
    const onCancel = vi.fn().mockResolvedValue(undefined);
    renderDialog({ onCancel, reservation: reservation({ cancellationFinancial: { ...financial, funding: walletFunding } }) });
    await openCancellation(); fillCancellation();
    const groups = within(screen.getByRole("region", { name: "تسویه مالی لغو رزرو" })).getAllByRole("group");
    groups.forEach((group, index) => {
      const cash = within(group).queryByLabelText(/بازپرداخت نقدی/);
      if (cash) fireEvent.change(cash, { target: { value: "0" } });
      fireEvent.change(within(group).getByLabelText(/بازگردانی به منبع اصلی کیف پول/), { target: { value: index === 0 ? "400" : "600" } });
      fireEvent.change(within(group).getByLabelText(/بازگردانده نمی‌شود/), { target: { value: "0" } });
    });
    [/سهم نهایی اقامتگاه/, /سهم نهایی کوچ/, /اعتبار\/مبلغ سوخت‌شده/].forEach(label =>
      fireEvent.change(screen.getByLabelText(label), { target: { value: "0" } }));
    expect(screen.queryByRole("combobox", { name: /روش بازپرداخت/ })).toBeNull();
    confirmCancellation();
    await waitFor(() => expect(onCancel).toHaveBeenCalledOnce());
    expect(onCancel.mock.calls[0][1].financialResolution).toEqual({ mode: "ManualFundingV2",
      finalPropertyShare: 0, finalKoochShare: 0, forfeitedAmount: 0,
      sourceDispositions: [
        { sourceToken: "cash-handle", cashRefundAmount: 0, walletRestoreAmount: 400, notReturnedAmount: 0 },
        { sourceToken: "promo-handle", cashRefundAmount: 0, walletRestoreAmount: 600, notReturnedAmount: 0 },
      ],
    });
  });

  it.each([0, null])("does not show a nonpositive or unknown paid amount (%s) or a financial section for an unpaid reservation", async amount => {
    renderDialog({ onCancel: vi.fn(), reservation: reservation({ paidAmount: amount,
      cancellationFinancial: { ...financial, paidCancellation: false, grossPaidAmount: amount } }) });
    await openCancellation();
    expect(screen.getByText("مبلغ رزرو")).toBeTruthy();
    expect(within(screen.getByRole("region", { name: "خلاصه رزرو" })).queryByText("مبلغ پرداخت‌شده")).toBeNull();
    expect(screen.queryByRole("region", { name: "تسویه مالی لغو رزرو" })).toBeNull();
  });

  it.each([
    { name: "pending mixed", cash: 400, wallet: 600, pending: true, executed: 0, status: "بازپرداخت نقدی در انتظار انجام" },
    { name: "completed mixed", cash: 400, wallet: 600, pending: false, executed: 400, status: "بازپرداخت نقدی ثبت شده است." },
    { name: "wallet-only", cash: 0, wallet: 1000, pending: false, executed: 0, status: "بازپرداخت نقدی لازم نیست." },
  ])("renders only the authoritative returned $name refund outcome", async ({ cash, wallet, pending, executed, status }) => {
    renderDialog({ onRefund: vi.fn(), reservation: reservation({ status: "Cancelled", allowedStatusTransitions: [],
      cancellationFinancial: { ...financial, mode: "ManualFundingV2", guestRefundAmount: cash,
        guestWalletRestoreAmount: wallet, cashRefundPendingAmount: cash - executed,
        cashRefundExecutedAmount: executed, refundPending: pending } }) });
    expect(await screen.findByText(status)).toBeTruthy();
    expect(screen.getByText("بازگردانی به منابع اصلی کیف پول")).toBeTruthy();
    expect(Boolean(screen.queryByText("بازپرداخت نقدی انجام‌شده"))).toBe(executed > 0);
    expect(Boolean(screen.queryByText("مبلغ بازپرداخت نقدی در انتظار انجام"))).toBe(pending);
    expect(Boolean(screen.queryByRole("button", { name: "ثبت بازپرداخت" }))).toBe(pending);
  });

  it("does not claim a cash refund is completed when response amounts are missing", async () => {
    renderDialog({ reservation: reservation({ status: "Cancelled", allowedStatusTransitions: [], cancellationFinancial: { ...financial } }) });
    expect(await screen.findByText("وضعیت اجرای بازپرداخت در دسترس نیست.")).toBeTruthy();
    expect(screen.queryByText("بازپرداخت نقدی ثبت شده است.")).toBeNull();
    expect(screen.queryByText("بازپرداخت نقدی انجام‌شده")).toBeNull();
  });

  it("validates required fields, exposes server validation and preserves the decision for retry", async () => {
    const onCancel = vi.fn().mockRejectedValue(new ApiRequestError("Validation failed", 400,
      { errors: { Explanation: ["توضیح دقیق‌تری برای لغو وارد کنید."] } }));
    renderDialog({ presentation: "page", onCancel, reservation: reservation({ cancellationFinancial: null }) });
    await openCancellation();
    fireEvent.click(screen.getByRole("button", { name: "تأیید و لغو رزرو" }));
    expect(onCancel).not.toHaveBeenCalled();
    expect(screen.getByLabelText(/دلیل لغو/).getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByLabelText(/توضیحات لغو/).getAttribute("aria-invalid")).toBe("true");
    fillCancellation();
    confirmCancellation();
    expect(await screen.findByText("توضیح دقیق‌تری برای لغو وارد کنید.")).toBeTruthy();
    expect(screen.getByLabelText(/توضیحات لغو/)).toHaveProperty("value", "درخواست مهمان");
    expect(screen.getByRole("dialog", { name: "لغو رزرو R-123456" })).toBeTruthy();
  });

  it("blocks duplicate cancellation and dismissal while saving, then closes on success", async () => {
    let finish!: () => void;
    const onCancel = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
    renderDialog({ presentation: "page", onCancel });
    await openCancellation();
    fillCancellation();
    fireEvent.click(screen.getByRole("button", { name: "تأیید و لغو رزرو" }));
    const dialog = screen.getByRole("dialog", { name: "تأیید نهایی لغو رزرو" });
    const submit = within(dialog).getByRole("button", { name: "لغو قطعی رزرو" });
    fireEvent.click(submit); fireEvent.click(submit);
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.click(within(dialog).getByRole("button", { name: "بستن" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "بازگشت به فرم" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("dialog", { name: "تأیید نهایی لغو رزرو" })).toBeTruthy();
    finish();
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "لغو رزرو R-123456" })).toBeNull());
  });

  it("separates the historical amount, actual paid funds and pending cash refund without promising execution", async () => {
    renderDialog({ onCancel: vi.fn(), reservation: reservation({ currency: "IRR", cancellationFinancial: {
      ...financial, cashRefundPendingAmount: 200,
    } }) });
    await openCancellation();
    expect(within(screen.getByRole("region", { name: "خلاصه رزرو" })).getByText(/۹۰۰۰/)).toBeTruthy();
    expect(within(screen.getByRole("region", { name: "خلاصه رزرو" })).getByText("۱۰۰۰ واحد")).toBeTruthy();
    expect(screen.queryByText(/بازپرداخت نقدی در انتظار ثبت: ۲۰۰/)).toBeNull();
    expect(screen.getByText(/ثبت لغو به معنی انجام بازپرداخت نقدی نیست/)).toBeTruthy();
  });

  it.each([null, undefined, { ...financial, paidCancellation: false }])(
    "keeps the unpaid/unknown cancellation form without financial inference: %s", async (cancellationFinancial) => {
      const onCancel = vi.fn().mockResolvedValue(undefined);
      renderDialog({ onCancel, reservation: reservation({ cancellationFinancial }) });
      await openCancellation();
      expect(screen.queryByRole("checkbox", { name: "می‌خواهم مبالغ را دستی تعیین کنم" })).toBeNull();
      expect(screen.queryByText(/مبلغ پرداخت‌شده:/)).toBeNull();
      fillCancellation();
      confirmCancellation();
      await waitFor(() => expect(onCancel).toHaveBeenCalledTimes(1));
      expect(onCancel.mock.calls[0][1]).toEqual({
        reason: "GuestRequest", explanation: "درخواست مهمان", idempotencyKey: "operation-1",
      });
    },
  );

  it("uses only cancellationFinancial.grossPaidAmount and defaults to automatic mode without stale manual fields", async () => {
    const onCancel = vi.fn().mockResolvedValue(undefined);
    renderDialog({ onCancel });
    await openCancellation();
    const section = screen.getByRole("region", { name: "تسویه مالی لغو رزرو" });
    expect(within(screen.getByRole("region", { name: "خلاصه رزرو" })).getByText("۱۰۰۰ واحد")).toBeTruthy();
    expect(within(section).queryByText(/۸۰۰۰|۹۰۰۰/)).toBeNull();
    setManualSplit("500", "300", "200");
    fireEvent.click(screen.getByRole("checkbox", { name: "می‌خواهم مبالغ را دستی تعیین کنم" }));
    fillCancellation();
    confirmCancellation();
    await waitFor(() => expect(onCancel).toHaveBeenCalledTimes(1));
    expect(onCancel.mock.calls[0][1].financialResolution).toEqual({ mode: "AutomaticFullRefundV1" });
  });

  it("requires exact, nonnegative two-decimal manual allocation and sends only the valid split and note", async () => {
    const onCancel = vi.fn().mockResolvedValue(undefined);
    renderDialog({ onCancel });
    await openCancellation();
    fillCancellation();
    setManualSplit("-1", "", "0");
    fireEvent.click(screen.getByRole("button", { name: "تأیید و لغو رزرو" }));
    expect(screen.getByRole("button", { name: "تأیید و لغو رزرو" })).toBeTruthy();
    expect(onCancel).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText(/مبلغ بازپرداخت به مهمان/), { target: { value: "500.25" } });
    fireEvent.change(screen.getByLabelText(/سهم نهایی اقامتگاه/), { target: { value: "300" } });
    expect(screen.getByText("جمع مبالغ باید دقیقاً برابر مبلغ پرداخت‌شده باشد.")).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/سهم نهایی کوچ/), { target: { value: "199.75" } });
    fireEvent.change(screen.getByLabelText("یادداشت تصمیم مالی (اختیاری)"), { target: { value: "تصمیم مدیر" } });
    confirmCancellation();
    await waitFor(() => expect(onCancel).toHaveBeenCalledTimes(1));
    expect(onCancel.mock.calls[0][1].financialResolution).toEqual({
      mode: "ManualOverride", guestRefundAmount: 500.25,
      finalPropertyShare: 300, finalKoochShare: 199.75, note: "تصمیم مدیر",
    });
  });

  it("keeps the cancellation key for an exact retry, rotates it after a changed decision, and does not optimistically cancel", async () => {
    const onCancel = vi.fn().mockRejectedValueOnce(new Error("network")).mockRejectedValueOnce(new Error("network"))
      .mockResolvedValue(undefined);
    renderDialog({ onCancel });
    await openCancellation();
    fillCancellation();
    confirmCancellation();
    await waitFor(() => expect(onCancel).toHaveBeenCalledTimes(1));
    expect(screen.getAllByText("تایید شده").length).toBeGreaterThan(0);
    confirmCancellation();
    await waitFor(() => expect(onCancel).toHaveBeenCalledTimes(2));
    expect(onCancel.mock.calls[0][1].idempotencyKey).toBe(onCancel.mock.calls[1][1].idempotencyKey);
    fireEvent.change(screen.getByLabelText(/دلیل لغو/), { target: { value: "Other" } });
    confirmCancellation();
    await waitFor(() => expect(onCancel).toHaveBeenCalledTimes(3));
    expect(onCancel.mock.calls[2][1].idempotencyKey).not.toBe(onCancel.mock.calls[1][1].idempotencyKey);
  });

  it("rotates the cancellation key when a manual amount changes after failure", async () => {
    const onCancel = vi.fn().mockRejectedValueOnce(new Error("network")).mockResolvedValue(undefined);
    renderDialog({ onCancel });
    await openCancellation();
    fillCancellation();
    setManualSplit("500", "300", "200");
    confirmCancellation();
    await waitFor(() => expect(onCancel).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByLabelText(/مبلغ بازپرداخت به مهمان/), { target: { value: "600" } });
    fireEvent.change(screen.getByLabelText(/سهم نهایی کوچ/), { target: { value: "100" } });
    confirmCancellation();
    await waitFor(() => expect(onCancel).toHaveBeenCalledTimes(2));
    expect(onCancel.mock.calls[1][1].idempotencyKey).not.toBe(onCancel.mock.calls[0][1].idempotencyKey);
  });

  it("shows a persisted cancelled resolution read-only and legacy null fields remain absent", async () => {
    const onRefund = vi.fn();
    const cancelled = reservation({ status: "Cancelled", allowedStatusTransitions: [],
      cancellationFinancial: { ...financial, mode: "ManualOverride", guestRefundAmount: 500,
        finalPropertyShare: 300, finalKoochShare: 200, refundPending: true } });
    const { rerender } = renderDialog({ reservation: cancelled, onRefund });
    await screen.findByRole("dialog", { name: "جزئیات رزرو" });
    expect(await screen.findByText("بازپرداخت نقدی در انتظار انجام")).toBeTruthy();
    expect(screen.getByRole("button", { name: "ثبت بازپرداخت" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "لغو رزرو" })).toBeNull();
    rerender(<ReservationDetailsDialog onOpenChange={vi.fn()} open onRefund={onRefund}
      reservation={{ ...cancelled, cancellationFinancial: { ...financial,
        alreadyHandledByLegacyRefundV1: true } }} />);
    expect(screen.queryByRole("button", { name: "ثبت بازپرداخت" })).toBeNull();
    expect(screen.getByText("بازپرداخت نقدی قبلاً ثبت شده است.")).toBeTruthy();
    expect(screen.queryByText("حالت مالی")).toBeNull();
    expect(screen.queryByText("سهم نهایی اقامتگاه")).toBeNull();
  });
});

describe("Admin reservation refund execution UI", () => {
  beforeEach(() => {
    let key = 0;
    vi.stubGlobal("crypto", { randomUUID: () => `refund-${++key}` });
  });
  afterEach(() => vi.unstubAllGlobals());

  function pendingReservation() {
    return reservation({ status: "Cancelled", allowedStatusTransitions: [],
      cancellationFinancial: { ...financial, mode: "ManualOverride", guestRefundAmount: 500,
        finalPropertyShare: 300, finalKoochShare: 200, refundPending: true } });
  }

  async function openRefund(onRefund: ComponentProps<typeof ReservationDetailsDialog>["onRefund"] = vi.fn()) {
    renderDialog({ reservation: pendingReservation(), onRefund });
    fireEvent.click(await screen.findByRole("button", { name: "ثبت بازپرداخت" }));
    return screen.findByRole("dialog", { name: "ثبت بازپرداخت" });
  }

  function fillRefund() {
    fireEvent.change(screen.getByLabelText(/مرجع انتقال/), { target: { value: "001234" } });
    fireEvent.change(screen.getByLabelText(/دلیل بازپرداخت/), { target: { value: "اصلاح رزرو" } });
  }

  it("shows the authoritative amount read-only, preserves leading zeroes, and sends no amount or internal IDs", async () => {
    const onRefund = vi.fn().mockResolvedValue(undefined);
    await openRefund(onRefund);
    expect(screen.getByText(/مبلغ بازپرداخت: ۵۰۰ واحد/)).toBeTruthy();
    expect(screen.queryByLabelText("مبلغ بازپرداخت")).toBeNull();
    fillRefund();
    fireEvent.click(within(screen.getByRole("dialog", { name: "ثبت بازپرداخت" }))
      .getByRole("button", { name: "ثبت بازپرداخت" }));
    await waitFor(() => expect(onRefund).toHaveBeenCalledTimes(1));
    const payload = onRefund.mock.calls[0][1];
    expect(payload.referenceNumber).toBe("001234");
    expect(payload.reason).toBe("اصلاح رزرو");
    expect(payload.refundedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(payload.idempotencyKey).toBe("refund-1");
    expect(Object.keys(payload).sort()).toEqual(["idempotencyKey", "note", "reason", "referenceNumber", "refundedAt"]);
  });

  it("reuses a key after failure and rotates it only when execution facts change", async () => {
    const onRefund = vi.fn().mockRejectedValueOnce(new Error("network")).mockRejectedValueOnce(new Error("network"))
      .mockResolvedValue(undefined);
    await openRefund(onRefund);
    fillRefund();
    fireEvent.click(within(screen.getByRole("dialog", { name: "ثبت بازپرداخت" }))
      .getByRole("button", { name: "ثبت بازپرداخت" }));
    await waitFor(() => expect(onRefund).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("dialog", { name: "ثبت بازپرداخت" })).toBeTruthy();
    fireEvent.click(within(screen.getByRole("dialog", { name: "ثبت بازپرداخت" }))
      .getByRole("button", { name: "ثبت بازپرداخت" }));
    await waitFor(() => expect(onRefund).toHaveBeenCalledTimes(2));
    expect(onRefund.mock.calls[0][1].idempotencyKey).toBe(onRefund.mock.calls[1][1].idempotencyKey);
    fireEvent.change(screen.getByLabelText(/مرجع انتقال/), { target: { value: "001235" } });
    fireEvent.click(within(screen.getByRole("dialog", { name: "ثبت بازپرداخت" }))
      .getByRole("button", { name: "ثبت بازپرداخت" }));
    await waitFor(() => expect(onRefund).toHaveBeenCalledTimes(3));
    expect(onRefund.mock.calls[2][1].idempotencyKey).not.toBe(onRefund.mock.calls[1][1].idempotencyKey);
  });

  it("blocks concurrent double-submit and keeps a failed form open", async () => {
    let finish!: () => void;
    const onRefund = vi.fn().mockImplementation(() => new Promise<void>((resolve) => { finish = resolve; }));
    await openRefund(onRefund);
    fillRefund();
    const submit = within(screen.getByRole("dialog", { name: "ثبت بازپرداخت" }))
      .getByRole("button", { name: "ثبت بازپرداخت" });
    fireEvent.click(submit);
    fireEvent.click(submit);
    expect(onRefund).toHaveBeenCalledTimes(1);
    finish();
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "ثبت بازپرداخت" })).toBeNull());
  });
});

describe("Admin guest cancellation request in reservation details", () => {
  const pendingRequest = {
    status: "Pending" as const,
    reason: "GuestRequest" as const,
    guestMessage: "لطفاً رزرو را لغو کنید.",
    requestedAtUtc: "2026-09-29T10:00:00Z",
    resolvedAtUtc: null,
    resolutionNote: null,
  };

  it("opens a support request form only for eligible reservations without Pending/Resolved requests", async () => {
    const onCreateCancellationRequest = vi.fn();
    const { rerender } = renderDialog({ onCancel: vi.fn(), onCreateCancellationRequest,
      reservation: reservation({ cancellationRequest: null }) });
    const create = await screen.findByRole("button", { name: "ثبت درخواست لغو از طرف مهمان" });
    fireEvent.click(create);
    const dialog = await screen.findByRole("dialog", { name: "ثبت درخواست لغو از طرف مهمان" });
    expect(within(dialog).getByText("این درخواست به نمایندگی از مهمان ثبت می‌شود و به معنی لغو فوری رزرو نیست.")).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "انصراف" }));
    expect(onCreateCancellationRequest).not.toHaveBeenCalled();
    rerender(<ReservationDetailsDialog onOpenChange={vi.fn()} open onCancel={vi.fn()}
      onCreateCancellationRequest={onCreateCancellationRequest}
      reservation={reservation({ cancellationRequest: pendingRequest })} />);
    expect(screen.queryByRole("button", { name: "ثبت درخواست لغو از طرف مهمان" })).toBeNull();
    rerender(<ReservationDetailsDialog onOpenChange={vi.fn()} open onCancel={vi.fn()}
      onCreateCancellationRequest={onCreateCancellationRequest}
      reservation={reservation({ status: "Cancelled", allowedStatusTransitions: [], cancellationRequest: null })} />);
    expect(screen.queryByRole("button", { name: "ثبت درخواست لغو از طرف مهمان" })).toBeNull();
  });

  it("requires a reason, offers the Guest reason set, and submits only reason/message", async () => {
    const onCreateCancellationRequest = vi.fn().mockResolvedValue(undefined);
    renderDialog({ onCancel: vi.fn(), onCreateCancellationRequest });
    fireEvent.click(await screen.findByRole("button", { name: "ثبت درخواست لغو از طرف مهمان" }));
    const dialog = await screen.findByRole("dialog", { name: "ثبت درخواست لغو از طرف مهمان" });
    const reason = within(dialog).getByLabelText(/دلیل درخواست/);
    expect(Array.from((reason as HTMLSelectElement).options).map((option) => option.value)).toEqual([
      "", "GuestRequest", "NonPayment", "NoAvailability", "PropertyRuleConflict",
      "DuplicateReservation", "InvalidGuestInformation", "PropertyMaintenanceOrForceMajeure",
      "AdministrativeCorrection", "Other", "PaymentExpired",
    ]);
    fireEvent.click(within(dialog).getByRole("button", { name: "ثبت درخواست" }));
    expect(await within(dialog).findByText("دلیل درخواست را انتخاب کنید.")).toBeTruthy();
    expect(onCreateCancellationRequest).not.toHaveBeenCalled();
    fireEvent.change(reason, { target: { value: "GuestRequest" } });
    fireEvent.change(within(dialog).getByLabelText("پیام (اختیاری)"), { target: { value: "  تماس تلفنی  " } });
    fireEvent.click(within(dialog).getByRole("button", { name: "ثبت درخواست" }));
    await waitFor(() => expect(onCreateCancellationRequest).toHaveBeenCalledWith(
      expect.objectContaining({ id: 12 }), { reason: "GuestRequest", message: "تماس تلفنی" },
    ));
  });

  it("prevents duplicate submission and preserves form values on an API error", async () => {
    let reject!: (error: Error) => void;
    const onCreateCancellationRequest = vi.fn().mockImplementation(() => new Promise<void>((_, fail) => { reject = fail; }));
    renderDialog({ onCancel: vi.fn(), onCreateCancellationRequest });
    fireEvent.click(await screen.findByRole("button", { name: "ثبت درخواست لغو از طرف مهمان" }));
    const dialog = await screen.findByRole("dialog", { name: "ثبت درخواست لغو از طرف مهمان" });
    fireEvent.change(within(dialog).getByLabelText(/دلیل درخواست/), { target: { value: "Other" } });
    fireEvent.change(within(dialog).getByLabelText("پیام (اختیاری)"), { target: { value: "متن درخواست" } });
    const submit = within(dialog).getByRole("button", { name: "ثبت درخواست" });
    fireEvent.click(submit);
    fireEvent.click(submit);
    await waitFor(() => expect(onCreateCancellationRequest).toHaveBeenCalledTimes(1));
    reject(new Error("خطای سرور"));
    expect(await within(dialog).findByRole("alert")).toHaveProperty("textContent", "خطای سرور");
    expect(within(dialog).getByLabelText(/دلیل درخواست/)).toHaveProperty("value", "Other");
    expect(within(dialog).getByLabelText("پیام (اختیاری)")).toHaveProperty("value", "متن درخواست");
  });

  it("shows source labels without exposing internal actor IDs and allows a new request after rejection", async () => {
    const onCreateCancellationRequest = vi.fn();
    const { rerender } = renderDialog({ onCancel: vi.fn(), onCreateCancellationRequest,
      reservation: reservation({ cancellationRequest: { ...pendingRequest, requestSource: "GuestOnline" } }) });
    expect(await screen.findByText("ثبت‌شده توسط مهمان")).toBeTruthy();
    expect(screen.queryByText("CreatedByUserId")).toBeNull();
    rerender(<ReservationDetailsDialog onOpenChange={vi.fn()} open onCancel={vi.fn()}
      onCreateCancellationRequest={onCreateCancellationRequest}
      reservation={reservation({ cancellationRequest: { ...pendingRequest, status: "Rejected", requestSource: "Support" } })} />);
    expect(screen.getByText("ثبت‌شده توسط پشتیبانی")).toBeTruthy();
    expect(screen.getByRole("button", { name: "ثبت درخواست لغو از طرف مهمان" })).toBeTruthy();
    rerender(<ReservationDetailsDialog onOpenChange={vi.fn()} open onCancel={vi.fn()}
      onCreateCancellationRequest={onCreateCancellationRequest}
      reservation={reservation({ cancellationRequest: { ...pendingRequest, status: "Resolved" } })} />);
    expect(screen.queryByRole("button", { name: "ثبت درخواست لغو از طرف مهمان" })).toBeNull();
  });

  it("omits the request section when the detail has no request", () => {
    renderDialog({ reservation: reservation({ cancellationRequest: null }) });
    expect(screen.queryByRole("region", { name: "درخواست لغو مهمان" })).toBeNull();
  });

  it("shows Pending context, reason, message, date, and both request actions", async () => {
    renderDialog({ reservation: reservation({ cancellationRequest: pendingRequest }),
      onCancel: vi.fn(), onRejectCancellationRequest: vi.fn() });
    await screen.findByRole("dialog", { name: "جزئیات رزرو" });
    const section = screen.getByRole("region", { name: "درخواست لغو مهمان" });
    expect(within(section).getByText("درخواست لغو در انتظار بررسی")).toBeTruthy();
    expect(within(section).getByText("درخواست مهمان")).toBeTruthy();
    expect(within(section).getByText("لطفاً رزرو را لغو کنید.")).toBeTruthy();
    expect(within(section).getByText("زمان درخواست")).toBeTruthy();
    expect(within(section).getByRole("button", { name: "رد درخواست" })).toBeTruthy();
    expect(within(section).getByRole("button", { name: "بررسی و انجام لغو" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "لغو رزرو" })).toBeNull();
  });

  it("confirms rejection with an optional note and does not submit on cancel", async () => {
    const onRejectCancellationRequest = vi.fn().mockResolvedValue(undefined);
    renderDialog({ reservation: reservation({ cancellationRequest: pendingRequest }),
      onCancel: vi.fn(), onRejectCancellationRequest });
    await screen.findByRole("dialog", { name: "جزئیات رزرو" });
    fireEvent.click(screen.getByRole("button", { name: "رد درخواست" }));
    const confirm = await screen.findByRole("alertdialog", { name: "رد درخواست لغو" });
    expect(onRejectCancellationRequest).not.toHaveBeenCalled();
    fireEvent.change(within(confirm).getByLabelText("یادداشت رد (اختیاری)"),
      { target: { value: "  اطلاعات کافی نیست  " } });
    fireEvent.click(within(confirm).getByRole("button", { name: "انصراف" }));
    expect(onRejectCancellationRequest).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "رد درخواست" }));
    fireEvent.change(screen.getByLabelText("یادداشت رد (اختیاری)"),
      { target: { value: "  اطلاعات کافی نیست  " } });
    fireEvent.click(within(screen.getByRole("alertdialog", { name: "رد درخواست لغو" }))
      .getByRole("button", { name: "رد درخواست" }));
    await waitFor(() => expect(onRejectCancellationRequest).toHaveBeenCalledTimes(1));
    expect(onRejectCancellationRequest).toHaveBeenCalledWith(expect.objectContaining({ id: 12 }), "اطلاعات کافی نیست");
  });

  it("prevents duplicate rejection and keeps failed confirmation open", async () => {
    let finish!: (error?: Error) => void;
    const onRejectCancellationRequest = vi.fn().mockImplementation(() => new Promise<void>((resolve, reject) => {
      finish = (error) => error ? reject(error) : resolve();
    }));
    renderDialog({ reservation: reservation({ cancellationRequest: pendingRequest }), onRejectCancellationRequest });
    await screen.findByRole("dialog", { name: "جزئیات رزرو" });
    fireEvent.click(screen.getByRole("button", { name: "رد درخواست" }));
    const confirm = await screen.findByRole("alertdialog", { name: "رد درخواست لغو" });
    const submit = within(confirm).getByRole("button", { name: "رد درخواست" });
    fireEvent.click(submit);
    fireEvent.click(submit);
    expect(onRejectCancellationRequest).toHaveBeenCalledTimes(1);
    finish(new Error("Conflict"));
    expect(await screen.findByRole("alertdialog", { name: "رد درخواست لغو" })).toBeTruthy();
  });

  it("opens the existing financial cancellation form without preselecting a decision", async () => {
    renderDialog({ reservation: reservation({ cancellationRequest: pendingRequest }), onCancel: vi.fn() });
    await screen.findByRole("dialog", { name: "جزئیات رزرو" });
    fireEvent.click(screen.getByRole("button", { name: "بررسی و انجام لغو" }));
    await screen.findByRole("dialog", { name: "لغو رزرو R-123456" });
    expect(screen.getByLabelText(/دلیل لغو/)).toHaveProperty("value", "");
    expect(screen.getByLabelText(/توضیحات لغو/)).toHaveProperty("value", "");
    expect(screen.getByRole("region", { name: "تسویه مالی لغو رزرو" })).toBeTruthy();
    expect(screen.getByRole("checkbox", { name: "می‌خواهم مبالغ را دستی تعیین کنم" })).toHaveProperty("checked", false);
  });

  it.each(["Rejected", "Resolved"] as const)("keeps %s request details read-only", async (status) => {
    renderDialog({ reservation: reservation({
      status: status === "Resolved" ? "Cancelled" : "Confirmed",
      cancellationRequest: { ...pendingRequest, status, resolvedAtUtc: "2026-09-30T10:00:00Z",
        resolutionNote: "بررسی شد" },
    }), onCancel: vi.fn(), onRejectCancellationRequest: vi.fn() });
    await screen.findByRole("dialog", { name: "جزئیات رزرو" });
    const section = screen.getByRole("region", { name: "درخواست لغو مهمان" });
    expect(within(section).getByText("زمان بررسی")).toBeTruthy();
    expect(within(section).getByText("بررسی شد")).toBeTruthy();
    expect(within(section).queryByRole("button", { name: "رد درخواست" })).toBeNull();
    expect(within(section).queryByRole("button", { name: "بررسی و انجام لغو" })).toBeNull();
  });

  it("renders the authoritative Resolved request after cancellation succeeds", async () => {
    const initial = reservation({ cancellationRequest: pendingRequest });
    const { rerender } = renderDialog({ reservation: initial, onCancel: vi.fn(),
      onRejectCancellationRequest: vi.fn() });
    await screen.findByRole("dialog", { name: "جزئیات رزرو" });
    rerender(<ReservationDetailsDialog open onOpenChange={vi.fn()} onCancel={vi.fn()}
      onRejectCancellationRequest={vi.fn()} reservation={{ ...initial, status: "Cancelled",
        cancellationRequest: { ...pendingRequest, status: "Resolved", resolvedAtUtc: "2026-09-30T10:00:00Z" } }} />);
    const section = screen.getByRole("region", { name: "درخواست لغو مهمان" });
    expect(within(section).getByText("درخواست بررسی‌شده")).toBeTruthy();
    expect(within(section).queryByRole("button")).toBeNull();
    expect(screen.getByText("تسویه مالی لغو رزرو")).toBeTruthy();
  });
});
