import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ReservationDetailsDialog } from "@/components/reservations/ReservationDetailsDialog";
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
  const groups = screen.getAllByRole("group");
  const change = (root: HTMLElement, label: string, value: string) => fireEvent.change(within(root).getByLabelText(label, { exact: false }), { target: { value } });
  change(groups[0], "بازپرداخت نقدی", "300");
  change(groups[0], "بازگردانده نمی‌شود", "100");
  change(groups[1], "بازپرداخت نقدی", "100");
  change(groups[1], "بازگشت به کیف پول", "100");
  change(groups[1], "بازگردانده نمی‌شود", "100");
  change(groups[2], "بازگشت به کیف پول", "200");
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
    renderDialog({ onCancel: vi.fn(), reservation: reservation({ cancellationFinancial: {
      ...financial, funding: externalFunding } }) });
    await openCancellation();
    const summary = screen.getByRole("region", { name: "خلاصه رزرو" });
    expect(within(summary).getByText("اقامتگاه آزمون")).toBeTruthy();
    expect(within(summary).getByText("مهمان آزمون")).toBeTruthy();
    expect(within(summary).getByText("تایید شده")).toBeTruthy();
    expect(within(summary).getByText("IRR")).toBeTruthy();
    expect(within(summary).getByText("۱۰۰۰ واحد")).toBeTruthy();
    const sources = screen.getByRole("region", { name: "منابع پرداخت" });
    expect(within(sources).getByText("پرداخت خارجی")).toBeTruthy();
    expect(within(sources).getByText(/بازپرداخت نقدی، بازگردانده نمی‌شود/)).toBeTruthy();
    expect(screen.getByRole("checkbox", { name: "می‌خواهم مبالغ را دستی تعیین کنم" })).toBeTruthy();
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
    const groups = screen.getAllByRole("group");
    expect(groups).toHaveLength(2);
    expect(within(groups[0]).getByLabelText(/بازپرداخت نقدی/)).toBeTruthy();
    expect(within(groups[0]).getByLabelText(/بازگشت به کیف پول/)).toBeTruthy();
    expect(within(groups[1]).queryByLabelText(/بازپرداخت نقدی/)).toBeNull();
    expect((screen.getByRole("button", { name: "ادامه لغو رزرو" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("renders authoritative funding capabilities and expiry without an automatic wallet decision", async () => {
    renderDialog({ onCancel: vi.fn(), reservation: reservation({ cancellationFinancial: { ...financial, funding } }) });
    await openCancellation();
    expect(screen.queryByRole("checkbox")).toBeNull();
    const groups = screen.getAllByRole("group");
    expect(groups).toHaveLength(3);
    expect(within(groups[0]).queryByLabelText(/بازگشت به کیف پول/)).toBeNull();
    expect(within(groups[1]).getByLabelText(/بازپرداخت نقدی/)).toBeTruthy();
    expect(within(groups[1]).getByLabelText(/بازگشت به کیف پول/)).toBeTruthy();
    expect(within(groups[2]).queryByLabelText(/بازپرداخت نقدی/)).toBeNull();
    expect(within(groups[2]).getByText(/منقضی شده و قابل استفاده نخواهد بود/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "ادامه لغو رزرو" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("reconciles live, confirms exact totals and sends only opaque source decisions", async () => {
    const onCancel = vi.fn().mockResolvedValue(undefined);
    renderDialog({ onCancel, reservation: reservation({ cancellationFinancial: { ...financial, funding } }) });
    await openCancellation(); fillCancellation(); fillFundingSplit();
    fireEvent.click(screen.getByRole("button", { name: "ادامه لغو رزرو" }));
    const confirmation = screen.getByRole("alert");
    expect(within(confirmation).getByText(/لغو رزرو نهایی شود/)).toBeTruthy();
    expect(within(confirmation).getAllByText("۴۰۰ واحد").length).toBeGreaterThan(0);
    expect(within(confirmation).getAllByText("۳۰۰ واحد").length).toBeGreaterThan(0);
    expect(within(confirmation).getByText("بازگردانده نمی‌شود")).toBeTruthy();
    expect(onCancel).not.toHaveBeenCalled();
    fireEvent.click(within(confirmation).getByRole("button", { name: "تایید و لغو رزرو" }));
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
    else fireEvent.change(within(screen.getAllByRole("group")[0]).getByLabelText(/بازپرداخت نقدی/),
      { target: { value: kind === "source" ? "299" : kind === "negative" ? "-1" : "299.999" } });
    expect((screen.getByRole("button", { name: "ادامه لغو رزرو" }) as HTMLButtonElement).disabled).toBe(true);
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
    expect(screen.getByText("نیازمند بازپرداخت")).toBeTruthy();
    const decisions = screen.getByRole("region", { name: "تصمیم نهایی منابع پرداخت" });
    expect(within(decisions).getAllByText(/بازپرداخت نقدی:/)).toHaveLength(3);
    expect(within(decisions).getAllByText(/بازگشت به کیف پول:/)).toHaveLength(3);
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
}

function fillCancellation() {
  fireEvent.change(screen.getByLabelText(/دلیل لغو/), { target: { value: "GuestRequest" } });
  fireEvent.change(screen.getByLabelText(/توضیحات لغو/), { target: { value: "درخواست مهمان" } });
}

function confirmCancellation() {
  fireEvent.click(screen.getByRole("button", { name: "ادامه لغو رزرو" }));
  fireEvent.click(screen.getByRole("button", { name: "تایید و لغو رزرو" }));
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
    expect(within(section).getByText(/مبلغ پرداخت‌شده: ۱۰۰۰ واحد/)).toBeTruthy();
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
    fireEvent.click(screen.getByRole("button", { name: "ادامه لغو رزرو" }));
    expect(screen.queryByRole("button", { name: "تایید و لغو رزرو" })).toBeNull();
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
    fireEvent.click(screen.getByRole("button", { name: "تایید و لغو رزرو" }));
    await waitFor(() => expect(onCancel).toHaveBeenCalledTimes(2));
    expect(onCancel.mock.calls[0][1].idempotencyKey).toBe(onCancel.mock.calls[1][1].idempotencyKey);
    fireEvent.click(screen.getByRole("button", { name: "بازگشت" }));
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
    fireEvent.click(screen.getByRole("button", { name: "بازگشت" }));
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
    expect(await screen.findByText("بازپرداخت مهمان هنوز ثبت نشده است.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "ثبت بازپرداخت" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "لغو رزرو" })).toBeNull();
    rerender(<ReservationDetailsDialog onOpenChange={vi.fn()} open onRefund={onRefund}
      reservation={{ ...cancelled, cancellationFinancial: { ...financial,
        alreadyHandledByLegacyRefundV1: true } }} />);
    expect(screen.queryByRole("button", { name: "ثبت بازپرداخت" })).toBeNull();
    expect(screen.getByText("بازپرداخت قبلاً ثبت شده است.")).toBeTruthy();
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
