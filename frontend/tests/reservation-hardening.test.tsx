import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  buildReservationMutationPayload,
} from "@/components/reservations/ManualReservationDialog";
import { ReservationDetailsDialog } from "@/components/reservations/ReservationDetailsDialog";
import type { ReservationTableItem } from "@/components/reservations/ReservationTable";

vi.mock("@/lib/currency", () => ({
  formatCurrency: (value?: number | null) => (value ?? 0).toString(),
  useSiteCurrencyLabel: () => "تومان",
}));

function reservation(
  overrides: Partial<ReservationTableItem> = {},
): ReservationTableItem {
  return {
    id: 1,
    reservationNumber: "KCH-TEST-1",
    propertyId: 10,
    propertyName: "اقامتگاه آزمون",
    roomTypeId: 20,
    roomTypeName: "اتاق دو نفره",
    roomId: 30,
    roomName: "اتاق ۱",
    guestId: 40,
    guestName: "مهمان آزمون",
    checkInDate: "2026-08-01",
    checkOutDate: "2026-08-03",
    adults: 2,
    children: 0,
    status: "PendingApproval",
    finalAmount: 1000,
    remainingAmount: 1000,
    allowedStatusTransitions: ["ApprovedAwaitingPayment", "Rejected"],
    ...overrides,
  };
}

describe("reservation hardening", () => {
  it.each(["create", "update"])(
    "includes the selected allowed status in the %s mutation payload",
    () => {
      const payload = buildReservationMutationPayload({
        status: "Confirmed",
        propertyId: 10,
        roomTypeId: 20,
        roomId: 30,
        guestId: 40,
        checkInDate: "2026-08-01",
        checkOutDate: "2026-08-03",
        adults: 2,
        children: 0,
        childAges: [],
        roomCount: 1,
        roomIds: [30],
        guestType: "Iranian",
        notes: null,
      });

      expect(payload.status).toBe("Confirmed");
    },
  );

  it("shows owner approval and rejection actions without cancellation", async () => {
    render(
      <ReservationDetailsDialog
        onOpenChange={vi.fn()}
        onStatusChange={vi.fn()}
        open
        reservation={reservation()}
      />,
    );

    expect(await screen.findByRole("button", { name: "آماده پرداخت" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "رد درخواست" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "لغو رزرو" })).toBeNull();
  });

  it("requires a cancellation explanation for every reason", async () => {
    render(
      <ReservationDetailsDialog
        onCancel={vi.fn()}
        onOpenChange={vi.fn()}
        open
        reservation={reservation({
          status: "Pending",
          allowedStatusTransitions: ["Cancelled"],
        })}
      />,
    );

    fireEvent.click(await screen.findByRole("button", { name: "لغو رزرو" }));
    fireEvent.change(await screen.findByLabelText(/دلیل لغو/), {
      target: { value: "GuestRequest" },
    });
    fireEvent.click(await screen.findByRole("button", { name: "ادامه لغو رزرو" }));

    expect(screen.getByText("توضیحات لغو را وارد کنید.")).toBeTruthy();
    expect(screen.queryByText("تایید نهایی لغو رزرو")).toBeNull();
  });

  it.each([
    "Cancelled",
    "Rejected",
    "PaymentExpired",
    "CapacityLost",
    "Completed",
  ])("keeps %s reservations read-only", async (status) => {
    render(
      <ReservationDetailsDialog
        onAdjustPrice={vi.fn()}
        onCancel={vi.fn()}
        onEdit={vi.fn()}
        onOpenChange={vi.fn()}
        onStatusChange={vi.fn()}
        open
        reservation={reservation({
          status,
          allowedStatusTransitions: ["Confirmed", "Cancelled"],
        })}
      />,
    );

    await screen.findByRole("dialog", { name: "جزئیات رزرو" });
    expect(screen.queryByRole("button", { name: "ویرایش" })).toBeNull();
    expect(screen.queryByRole("button", { name: "لغو رزرو" })).toBeNull();
    expect(screen.queryByRole("button", { name: "تایید رزرو" })).toBeNull();
  });

  it("preserves the confirmed reservation edit warning", async () => {
    const onEdit = vi.fn();
    render(
      <ReservationDetailsDialog
        onEdit={onEdit}
        onOpenChange={vi.fn()}
        open
        reservation={reservation({ status: "Confirmed" })}
      />,
    );

    fireEvent.click(await screen.findByRole("button", { name: "ویرایش" }));

    expect(onEdit).not.toHaveBeenCalled();
    expect(
      await screen.findByRole("alertdialog", { name: "ویرایش رزرو تاییدشده" }),
    ).toBeTruthy();
  });

  it("keeps the existing payment deadline presentation", async () => {
    const deadline = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    render(
      <ReservationDetailsDialog
        onOpenChange={vi.fn()}
        open
        reservation={reservation({
          status: "ApprovedAwaitingPayment",
          paymentExpiresAtUtc: deadline,
          remainingPaymentSeconds: 600,
        })}
      />,
    );

    await screen.findByRole("dialog", { name: "جزئیات رزرو" });
    const deadlineSection = screen
      .getByRole("heading", { name: "مهلت پرداخت" })
      .closest("section");
    expect(deadlineSection).toBeTruthy();
    expect(within(deadlineSection!).getByText("زمان باقی‌مانده")).toBeTruthy();
  });
});
