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
