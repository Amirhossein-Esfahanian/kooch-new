import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";
import {
  ReservationDetailsDialog,
  type AdminManualPayment,
} from "@/components/reservations/ReservationDetailsDialog";
import type { ReservationTableItem } from "@/components/reservations/ReservationTable";

vi.mock("@/lib/currency", () => ({
  formatCurrency: (value?: number | null) => String(value ?? 0),
  useSiteCurrencyLabel: () => "تومان",
}));

const reservation: ReservationTableItem = {
  id: 12,
  reservationNumber: "RSV-12",
  propertyName: "اقامتگاه آزمون",
  roomTypeName: "اتاق آزمون",
  guestName: "مهمان آزمون",
  checkInDate: "2026-09-20",
  checkOutDate: "2026-09-22",
  status: "ApprovedAwaitingPayment",
  finalAmount: 250000,
  remainingAmount: 200000,
  currency: "IRR",
};

function payment(
  overrides: Partial<AdminManualPayment> = {},
): AdminManualPayment {
  return {
    paymentId: 41,
    reservationId: 12,
    amount: 200000,
    currency: "IRR",
    status: "Pending",
    method: "BankTransfer",
    verificationStatus: "PendingVerification",
    paymentDate: "2026-09-25",
    paymentTime: "12:30:00",
    referenceNumber: "REF-41",
    destinationBank: "بانک آزمون",
    destinationAccountReference: "ACC-1",
    notes: "یادداشت آزمون",
    submittedBy: "مدیر آزمون",
    submittedAtUtc: "2026-09-25T09:00:00Z",
    ...overrides,
  };
}

function renderDialog(props: Partial<ComponentProps<typeof ReservationDetailsDialog>> = {}) {
  return render(
    <ReservationDetailsDialog
      onOpenChange={vi.fn()}
      open
      reservation={reservation}
      {...props}
    />,
  );
}

describe("Admin manual payment reservation UI", () => {
  it("shows create only for an eligible reservation and exposes no evidence field", async () => {
    renderDialog({ onCreateManualPayment: vi.fn() });

    fireEvent.click(await screen.findByRole("button", { name: "ثبت پرداخت دستی" }));

    const createDialog = await screen.findByRole("dialog", { name: "ثبت پرداخت دستی" });
    expect((within(createDialog).getByLabelText(/^مبلغ/) as HTMLInputElement).value).toBe("200000");
    expect((within(createDialog).getByLabelText(/^واحد پول/) as HTMLInputElement).value).toBe("IRR");
    expect((within(createDialog).getByLabelText(/^واحد پول/) as HTMLInputElement).readOnly).toBe(true);
    expect(within(createDialog).queryByLabelText(/مدرک|فایل|رسید/)).toBeNull();
  });

  it("does not show create for an ineligible reservation", async () => {
    render(
      <ReservationDetailsDialog
        onCreateManualPayment={vi.fn()}
        onOpenChange={vi.fn()}
        open
        reservation={{ ...reservation, status: "Confirmed" }}
      />,
    );
    await screen.findByRole("dialog", { name: "جزئیات رزرو" });
    expect(screen.queryByRole("button", { name: "ثبت پرداخت دستی" })).toBeNull();
  });

  it("submits only the manual payment fields with the authoritative reservation currency", async () => {
    const onCreate = vi.fn().mockResolvedValue(undefined);
    renderDialog({ onCreateManualPayment: onCreate });
    fireEvent.click(await screen.findByRole("button", { name: "ثبت پرداخت دستی" }));
    const createDialog = await screen.findByRole("dialog", { name: "ثبت پرداخت دستی" });
    fireEvent.change(within(createDialog).getByLabelText("شماره پیگیری"), { target: { value: "  TRACK-1  " } });
    fireEvent.click(within(createDialog).getByRole("button", { name: "ثبت پرداخت" }));

    await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(1));
    expect(onCreate.mock.calls[0][1]).toEqual(expect.objectContaining({
      amount: 200000,
      currency: "IRR",
      method: "BankTransfer",
      referenceNumber: "TRACK-1",
    }));
    expect(onCreate.mock.calls[0][1]).not.toHaveProperty("evidenceFilePath");
  });

  it("blocks an invalid amount", async () => {
    const onCreate = vi.fn();
    renderDialog({ onCreateManualPayment: onCreate });
    fireEvent.click(await screen.findByRole("button", { name: "ثبت پرداخت دستی" }));
    const createDialog = await screen.findByRole("dialog", { name: "ثبت پرداخت دستی" });
    fireEvent.change(within(createDialog).getByLabelText(/^مبلغ/), { target: { value: "0" } });
    fireEvent.click(within(createDialog).getByRole("button", { name: "ثبت پرداخت" }));

    expect(await screen.findByText("مبلغ پرداخت باید بیشتر از صفر باشد.")).toBeTruthy();
    expect(onCreate).not.toHaveBeenCalled();
  });

  it("requires confirmation before approving a pending payment", async () => {
    const onApprove = vi.fn().mockResolvedValue(undefined);
    renderDialog({ manualPayments: [payment()], onApproveManualPayment: onApprove });
    fireEvent.click(await screen.findByRole("button", { name: "تأیید پرداخت" }));

    expect(onApprove).not.toHaveBeenCalled();
    const confirmation = await screen.findByRole("alertdialog", { name: "تأیید پرداخت دستی" });
    fireEvent.click(within(confirmation).getByRole("button", { name: "تأیید پرداخت" }));
    await waitFor(() => expect(onApprove).toHaveBeenCalledWith(41));
  });

  it("requires a trimmed rejection reason and sends it", async () => {
    const onReject = vi.fn().mockResolvedValue(undefined);
    renderDialog({ manualPayments: [payment()], onRejectManualPayment: onReject });
    fireEvent.click(await screen.findByRole("button", { name: "رد پرداخت" }));
    const rejectionDialog = await screen.findByRole("dialog", { name: "رد پرداخت دستی" });
    fireEvent.click(within(rejectionDialog).getByRole("button", { name: "رد پرداخت" }));
    expect(await screen.findByText("دلیل رد پرداخت را وارد کنید.")).toBeTruthy();
    fireEvent.change(within(rejectionDialog).getByLabelText(/^دلیل رد/), { target: { value: "  اطلاعات نامعتبر  " } });
    fireEvent.click(within(rejectionDialog).getByRole("button", { name: "رد پرداخت" }));
    await waitFor(() => expect(onReject).toHaveBeenCalledWith(41, "اطلاعات نامعتبر"));
  });

  it("shows review metadata and hides terminal payment actions", async () => {
    renderDialog({
      manualPayments: [payment({
        status: "Failed",
        verificationStatus: "Rejected",
        rejectionReason: "قابل تطبیق نبود",
        rejectedBy: "مدیر دوم",
        rejectedAtUtc: "2026-09-25T10:00:00Z",
      })],
      onApproveManualPayment: vi.fn(),
      onRejectManualPayment: vi.fn(),
    });

    expect(await screen.findByText("رد شده")).toBeTruthy();
    expect(screen.getByText("قابل تطبیق نبود")).toBeTruthy();
    expect(screen.getByText(/مدیر دوم/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "تأیید پرداخت" })).toBeNull();
    expect(screen.queryByRole("button", { name: "رد پرداخت" })).toBeNull();
  });

  it("shows a successful approved payment without terminal actions", async () => {
    renderDialog({
      manualPayments: [payment({
        status: "Successful",
        verificationStatus: "Approved",
        verifiedBy: "مدیر تأییدکننده",
        verifiedAtUtc: "2026-09-25T10:00:00Z",
      })],
      onApproveManualPayment: vi.fn(),
      onRejectManualPayment: vi.fn(),
    });

    expect(await screen.findByText("تأیید شده")).toBeTruthy();
    expect(screen.getByText("موفق")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "تأیید پرداخت" })).toBeNull();
    expect(screen.queryByRole("button", { name: "رد پرداخت" })).toBeNull();
  });

  it("does not expose direct reservation confirmation through the payment section", async () => {
    renderDialog({ manualPayments: [payment()] });
    await screen.findByText("پرداخت‌های دستی");
    expect(screen.queryByRole("button", { name: "تأیید رزرو" })).toBeNull();
  });
});
