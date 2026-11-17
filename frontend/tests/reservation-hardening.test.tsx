import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
  it.each([400, 160])("reveals cancellation inside a %ipx dialog body, focuses its reason and restores the trigger on dismissal", async height => {
    const onCancel = vi.fn();
    render(<ReservationDetailsDialog onCancel={onCancel} onOpenChange={vi.fn()} open
      reservation={reservation({ status: "Pending", allowedStatusTransitions: ["Cancelled"] })} />);
    const dialog = await screen.findByRole("dialog", { name: "جزئیات رزرو" });
    const body = dialog.querySelector<HTMLElement>('[data-slot="dialog-body"]')!;
    body.scrollTop = 600;
    const pageScroll = document.documentElement.scrollTop;
    vi.spyOn(body, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 100, 500, height));
    fireEvent.click(within(dialog).getByRole("button", { name: "لغو رزرو" }));
    const reason = within(dialog).getByLabelText(/دلیل لغو/) as HTMLSelectElement;
    const form = reason.closest('[role="alert"]')!.parentElement!;
    vi.spyOn(form, "getBoundingClientRect").mockReturnValue(new DOMRect(0, -480, 500, 600));
    vi.spyOn(reason, "getBoundingClientRect").mockReturnValue(new DOMRect(0, -290, 200, 40));
    const focus = vi.spyOn(reason, "focus");
    await waitFor(() => expect(document.activeElement).toBe(reason));
    expect(body.scrollTop).toBe(height === 400 ? 20 : 106);
    expect(document.documentElement.scrollTop).toBe(pageScroll);
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
    fireEvent.change(reason, { target: { value: "GuestRequest" } });
    fireEvent.change(within(dialog).getByLabelText(/توضیحات لغو/), { target: { value: "درخواست مهمان" } });
    expect(focus).toHaveBeenCalledTimes(1);
    fireEvent.click(within(dialog).getByRole("button", { name: "انصراف" }));
    const trigger = within(dialog).getByRole("button", { name: "لغو رزرو" });
    await waitFor(() => expect(document.activeElement).toBe(trigger));
    expect(screen.queryByLabelText(/دلیل لغو/)).toBeNull();
    expect(onCancel).not.toHaveBeenCalled();
    expect(document.documentElement.scrollTop).toBe(pageScroll);
  });

  it("also restores the pending-request cancellation trigger without acting on the reservation", async () => {
    const onCancel = vi.fn();
    render(<ReservationDetailsDialog onCancel={onCancel} onOpenChange={vi.fn()} open
      reservation={reservation({ allowedStatusTransitions: ["Cancelled"], cancellationRequest: {
        status: "Pending", reason: "GuestRequest", requestedAtUtc: "2026-11-16T10:00:00Z",
        guestMessage: null, resolvedAtUtc: null, resolutionNote: null,
      } })} />);
    const trigger = await screen.findByRole("button", { name: "بررسی و انجام لغو" });
    fireEvent.click(trigger);
    const reason = screen.getByLabelText(/دلیل لغو/);
    await waitFor(() => expect(document.activeElement).toBe(reason));
    fireEvent.click(screen.getByRole("button", { name: "انصراف" }));
    await waitFor(() => expect(document.activeElement).toBe(trigger));
    expect(onCancel).not.toHaveBeenCalled();
  });

  it.each(["Cancelled", "Confirmed", "Pending", "Completed"])("offers order settlement based only on the current %s room context", async status => {
    render(<ReservationDetailsDialog onOpenChange={vi.fn()} onOrderSettled={vi.fn()} open
      reservation={reservation({ source: "AdminCreated", bookingSessionId: 7, status })} />);
    await screen.findByRole("dialog", { name: "جزئیات رزرو" });
    expect(Boolean(screen.queryByRole("button", { name: "ثبت تسویهٔ کل سفارش" }))).toBe(status !== "Cancelled");
  });

  it("retains settlement access from a non-cancelled sibling in the same manual order", async () => {
    const props = { onOpenChange: vi.fn(), onOrderSettled: vi.fn(), open: true };
    const cancelled = reservation({ source: "AdminCreated", bookingSessionId: 7, status: "Cancelled" });
    const { rerender } = render(<ReservationDetailsDialog {...props} reservation={cancelled} />);
    await screen.findByRole("dialog", { name: "جزئیات رزرو" });
    expect(screen.queryByRole("button", { name: "ثبت تسویهٔ کل سفارش" })).toBeNull();
    rerender(<ReservationDetailsDialog {...props} reservation={{ ...cancelled, id: 2, reservationNumber: "R-SIBLING", status: "Confirmed" }} />);
    expect(screen.getByRole("button", { name: "ثبت تسویهٔ کل سفارش" })).toBeTruthy();
    rerender(<ReservationDetailsDialog {...props} reservation={cancelled} />);
    expect(screen.queryByRole("button", { name: "ثبت تسویهٔ کل سفارش" })).toBeNull();
  });

  it("does not infer a standard rate from a list item before details load", async () => {
    render(<ReservationDetailsDialog onOpenChange={vi.fn()} open
      reservation={reservation()} />);

    await screen.findByRole("dialog", { name: "جزئیات رزرو" });
    expect(screen.queryByText("نوع نرخ")).toBeNull();
  });

  it.each([
    { ratePlanId: null, ratePlanName: null, mealPlanName: null, expected: "نرخ استاندارد" },
    { ratePlanId: 7, ratePlanName: "بدون صبحانه", mealPlanName: "فقط اقامت", expected: "بدون صبحانه" },
    { ratePlanId: 7, ratePlanName: null, mealPlanName: null, expected: "نرخ رزروشده" },
  ])("shows the booked historical rate in shared reservation details: $expected", async (rate) => {
    render(<ReservationDetailsDialog onOpenChange={vi.fn()} open
      reservation={reservation(rate)} />);

    await screen.findByRole("dialog", { name: "جزئیات رزرو" });
    const stay = screen.getByRole("heading", { name: "اقامت" }).closest("section")!;
    expect(within(stay).getByText("نوع نرخ")).toBeTruthy();
    expect(within(stay).getByText(rate.expected)).toBeTruthy();
    if (rate.mealPlanName) {
      expect(within(stay).getByText("وعده غذایی")).toBeTruthy();
      expect(within(stay).getByText(rate.mealPlanName)).toBeTruthy();
    } else {
      expect(within(stay).queryByText("وعده غذایی")).toBeNull();
    }
  });

  it.each([null, "09123456789"])("shows guest phone only when returned by the API: %s", async (guestMobile) => {
    render(<ReservationDetailsDialog onOpenChange={vi.fn()} open
      reservation={reservation({ guestMobile })} />);
    await screen.findByText("نام کامل");
    if (guestMobile) {
      expect(screen.getByText("شماره تماس")).toBeTruthy();
      expect(screen.getByText("۰۹۱۲۳۴۵۶۷۸۹")).toBeTruthy();
    } else {
      expect(screen.queryByText("شماره تماس")).toBeNull();
    }
  });
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
