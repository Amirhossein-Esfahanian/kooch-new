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
  it("offers manual payment preparation only from the server capability and confirms just that reservation", async () => {
    const prepare = vi.fn().mockResolvedValue(undefined);
    const status = vi.fn();
    const item = reservation({ status: "Pending", source: "AdminCreated", canPrepareManualPayment: true,
      allowedStatusTransitions: ["Cancelled"] });
    const { rerender } = render(<ReservationDetailsDialog presentation="page" open reservation={item}
      onOpenChange={vi.fn()} onPrepareManualPayment={prepare} onStatusChange={status} />);
    const trigger = screen.getByRole("button", { name: "آماده‌سازی برای پرداخت" });
    expect(trigger.className).toContain("bg-primary");
    expect(screen.queryByRole("button", { name: "تأیید رزرو" })).toBeNull();
    fireEvent.click(trigger);
    const dialog = await screen.findByRole("alertdialog", { name: "آماده‌سازی برای پرداخت" });
    expect(within(dialog).getByText(/هیچ وجهی دریافت/)).toBeTruthy();
    expect(prepare).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "آماده‌سازی برای پرداخت" }));
    await waitFor(() => expect(prepare).toHaveBeenCalledExactlyOnceWith(item));
    expect(status).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    rerender(<ReservationDetailsDialog presentation="page" open reservation={{ ...item,
      canPrepareManualPayment: false, status: "ApprovedAwaitingPayment", paymentExpiresAtUtc: "2026-11-20T12:45:00Z" }}
      onOpenChange={vi.fn()} onPrepareManualPayment={prepare} onStatusChange={status} />);
    expect(screen.queryByRole("button", { name: "آماده‌سازی برای پرداخت" })).toBeNull();
    expect(screen.getAllByText(/مهلت پرداخت/).length).toBeGreaterThan(0);
  });

  it.each([false, undefined])("does not infer preparation from Pending or admin origin when capability is %s", capability => {
    render(<ReservationDetailsDialog presentation="page" open reservation={reservation({ status: "Pending",
      source: "AdminCreated", canPrepareManualPayment: capability, allowedStatusTransitions: [] })}
      onOpenChange={vi.fn()} onPrepareManualPayment={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "آماده‌سازی برای پرداخت" })).toBeNull();
  });

  it("reuses details on a page with one status badge, scoped primary action and working confirmation", async () => {
    const onStatusChange = vi.fn();
    const item = reservation();
    const { rerender } = render(<ReservationDetailsDialog presentation="page" open reservation={item}
      onOpenChange={vi.fn()} onStatusChange={onStatusChange} />);
    expect(screen.getByRole("heading", { level: 1, name: /رزرو KCH-TEST/ })).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getAllByText("در انتظار تایید", { exact: true })).toHaveLength(1);
    expect(screen.getByRole("heading", { name: "مبالغ این رزرو" })).toBeTruthy();
    const approve = screen.getByRole("button", { name: "آماده پرداخت" });
    expect(approve.className).toContain("bg-primary");
    fireEvent.click(approve);
    await screen.findByRole("alertdialog", { name: "آماده پرداخت" });
    rerender(<ReservationDetailsDialog presentation="page" open reservation={{ ...item, remainingAmount: 900 }}
      onOpenChange={vi.fn()} onStatusChange={onStatusChange} />);
    expect(screen.getByRole("alertdialog", { name: "آماده پرداخت" })).toBeTruthy();
    expect(onStatusChange).not.toHaveBeenCalled();
  });

  it("does not highlight an action when primary eligibility is not established", () => {
    render(<ReservationDetailsDialog presentation="page" open reservation={reservation({ allowedStatusTransitions: [] })}
      onOpenChange={vi.fn()} onStatusChange={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "آماده پرداخت" })).toBeNull();
  });

  it.each(["page", "dialog"] as const)("opens blocking cancellation from %s without scrolling the background and restores focus", async presentation => {
    const onCancel = vi.fn(), onOpenChange = vi.fn();
    render(<ReservationDetailsDialog presentation={presentation} onCancel={onCancel} onOpenChange={onOpenChange} open
      reservation={reservation({ status: "Confirmed", allowedStatusTransitions: ["Cancelled"] })} />);
    const trigger = await screen.findByRole("button", { name: "لغو رزرو" });
    trigger.focus();
    const scroll = document.documentElement.scrollTop;
    fireEvent.click(trigger);
    const dialog = await screen.findByRole("dialog", { name: "لغو رزرو KCH-TEST-1" });
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(dialog.closest('[data-slot="dialog-root"]')?.parentElement).toBe(document.body);
    expect(document.body.style.overflow).toBe("hidden");
    await waitFor(() => expect(document.activeElement).toBe(within(dialog).getByRole("button", { name: "انصراف" })));
    // jsdom has no layout; model visibility for both shared dialog focus scopes.
    document.querySelectorAll<HTMLElement>("button, input, select, textarea").forEach(control =>
      Object.defineProperty(control, "offsetParent", { configurable: true, get: () => control.closest('[role="dialog"]') }));
    fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement).toBe(within(dialog).getByRole("button", { name: "بستن" }));
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(within(dialog).getByRole("button", { name: "انصراف" }));
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "لغو رزرو KCH-TEST-1" })).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(trigger));
    expect(document.documentElement.scrollTop).toBe(scroll);
    expect(onCancel).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("restores the pending-request cancellation trigger without acting on the reservation", async () => {
    const onCancel = vi.fn();
    render(<ReservationDetailsDialog onCancel={onCancel} onOpenChange={vi.fn()} open
      reservation={reservation({ allowedStatusTransitions: ["Cancelled"], cancellationRequest: {
        status: "Pending", reason: "GuestRequest", requestedAtUtc: "2026-11-16T10:00:00Z",
        guestMessage: null, resolvedAtUtc: null, resolutionNote: null,
      } })} />);
    const trigger = await screen.findByRole("button", { name: "بررسی و انجام لغو" });
    trigger.focus();
    fireEvent.click(trigger);
    const dialog = await screen.findByRole("dialog", { name: "لغو رزرو KCH-TEST-1" });
    fireEvent.click(within(dialog).getByRole("button", { name: "انصراف" }));
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
    fireEvent.click(await screen.findByRole("button", { name: "تایید و لغو رزرو" }));

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
