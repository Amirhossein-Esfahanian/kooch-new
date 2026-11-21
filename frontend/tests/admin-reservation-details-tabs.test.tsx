import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ComponentProps } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ReservationDetailsDialog } from "@/components/reservations/ReservationDetailsDialog";
import type { ReservationTableItem } from "@/components/reservations/ReservationTable";

const request = vi.hoisted(() => vi.fn());
vi.mock("@/lib/owner-api", async original => ({
  ...(await original<typeof import("@/lib/owner-api")>()), apiRequest: request,
}));
vi.mock("@/lib/currency", async original => ({
  ...(await original<typeof import("@/lib/currency")>()), useSiteCurrencyLabel: () => "ریال",
}));

const item: ReservationTableItem = {
  id: 37, reservationNumber: "R-TEST-37", source: "AdminCreated", propertyName: "اقامتگاه آزمون",
  guestName: "مهمان آزمون", guestMobile: "09120000000", roomTypeName: "اتاق دبل", ratePlanId: null,
  checkInDate: "2030-02-01", checkOutDate: "2030-02-03", adults: 2, children: 0,
  status: "Pending", currency: "IRR", finalAmount: 1000, paidAmount: 0, remainingAmount: 1000,
  allowedStatusTransitions: ["Cancelled"], createdBy: "مدیر آزمون", createdAtUtc: "2030-01-01T10:00:00Z",
};
function show(props: Partial<ComponentProps<typeof ReservationDetailsDialog>> = {}) {
  return render(<ReservationDetailsDialog presentation="page" open onOpenChange={vi.fn()} reservation={item} {...props} />);
}
function tab(name: string) { fireEvent.click(screen.getByRole("tab", { name })); }

describe("Admin reservation details tabbed page", () => {
  beforeEach(() => {
    request.mockReset();
    request.mockResolvedValue([]);
  });

  it("keeps one shared header and routes existing actions into their own tab", () => {
    const edit = vi.fn(), voucher = vi.fn(), task = vi.fn();
    show({ onEdit: edit, onViewVoucher: voucher, onAssignTask: task });
    const header = screen.getByRole("heading", { level: 1 }).closest("header")!;
    expect(within(header).getByText("مهمان آزمون")).toBeTruthy();
    expect(within(header).getByText("اقامتگاه آزمون")).toBeTruthy();
    expect(within(header).getByText("بدون پرداخت ثبت‌شده")).toBeTruthy();
    expect(within(header).getByText("ورود")).toBeTruthy();
    expect(within(header).getByText("خروج")).toBeTruthy();
    expect(screen.getByRole("tab", { name: "رزرو و مهمان" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("heading", { name: "ایجاد رزرو" })).toBeTruthy();
    expect(screen.getByText("اتاق دبل")).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "مبالغ این رزرو" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "خط زمانی" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "ویرایش" }));
    fireEvent.click(screen.getByRole("button", { name: "مشاهده ووچر" }));
    expect(edit).toHaveBeenCalledExactlyOnceWith(item);
    expect(voucher).toHaveBeenCalledExactlyOnceWith(item);
    tab("پرداخت و بازپرداخت");
    expect(screen.getByRole("heading", { name: "خلاصه مالی این رزرو" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "ویرایش" })).toBeNull();
    expect(screen.queryByRole("button", { name: "ارجاع کار" })).toBeNull();
    tab("فعالیت‌ها و یادداشت‌ها");
    expect(screen.getByRole("heading", { name: "خط زمانی" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "ارجاع کار" }));
    expect(task).toHaveBeenCalledExactlyOnceWith(item);
    expect(screen.getByRole("heading", { level: 1 }).closest("header")).toBe(header);
  });

  it("implements manual activation, roving focus, Home/End and RTL arrows", () => {
    show();
    const tabs = screen.getAllByRole("tab");
    tabs[0].focus();
    fireEvent.keyDown(tabs[0], { key: "ArrowLeft" });
    expect(document.activeElement).toBe(tabs[1]);
    expect(tabs[0].getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(tabs[1], { key: "Enter" });
    expect(tabs[1].getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("tabpanel").id).toBe(tabs[1].getAttribute("aria-controls"));
    fireEvent.keyDown(tabs[1], { key: "End" });
    expect(document.activeElement).toBe(tabs[2]);
    fireEvent.keyDown(tabs[2], { key: "Home" });
    expect(document.activeElement).toBe(tabs[0]);
    fireEvent.keyDown(tabs[0], { key: "ArrowRight" });
    expect(document.activeElement).toBe(tabs[2]);
    fireEvent.keyDown(tabs[2], { key: " " });
    expect(tabs[2].getAttribute("aria-selected")).toBe("true");
    expect(tabs.filter(button => button.tabIndex === 0)).toHaveLength(1);
  });

  it("orders journey milestones chronologically without mutating data and connects adjacent events only", () => {
    const timeline: NonNullable<ReservationTableItem["timeline"]> = [
      { type: "Paid", timestampUtc: "2030-01-03T10:00:00Z", actor: "پرداخت‌کننده" },
      { type: "Created", timestampUtc: "2030-01-01T10:00:00Z", note: "جزئیات ایجاد" },
      { type: "Approved", timestampUtc: "2030-01-02T10:00:00Z" },
    ];
    show({ reservation: { ...item, timeline } });
    tab("فعالیت‌ها و یادداشت‌ها");
    const journey = screen.getByRole("list", { name: "مسیر رزرو" });
    const milestones = within(journey).getAllByRole("listitem");
    expect(milestones.map(row => row.querySelector("time")?.dateTime)).toEqual([
      "2030-01-01T10:00:00Z", "2030-01-02T10:00:00Z", "2030-01-03T10:00:00Z",
    ]);
    expect(journey.getAttribute("dir")).toBe("rtl");
    expect(journey.querySelectorAll("[data-journey-connector]")).toHaveLength(2);
    expect(milestones[2].querySelector("[data-journey-connector]")).toBeNull();
    expect(within(journey).getByText("جزئیات ایجاد")).toBeTruthy();
    expect(within(journey).getByText(/پرداخت‌کننده/)).toBeTruthy();
    expect(timeline[0].type).toBe("Paid");
  });

  it("does not draw a connector for a single milestone", () => {
    show({ reservation: { ...item, timeline: [{ type: "Created", timestampUtc: item.createdAtUtc! }] } });
    tab("فعالیت‌ها و یادداشت‌ها");
    const journey = screen.getByRole("list", { name: "مسیر رزرو" });
    expect(within(journey).getAllByRole("listitem")).toHaveLength(1);
    expect(journey.querySelector("[data-journey-connector]")).toBeNull();
  });

  it("identifies preparation only by activity type, not a matching timestamp or current reservation status", async () => {
    request.mockResolvedValue([
      { id: 20, actorUserId: 1, actorDisplayName: "مدیر", activityType: "PaymentPrepared", title: "رزرو دستی برای پرداخت آماده شد", details: "جزئیات آماده‌سازی", occurredAtUtc: "2030-01-02T10:00:00Z" },
      { id: 21, actorUserId: 1, actorDisplayName: "مدیر", activityType: "Approved", title: "تأیید واقعی درخواست", details: "جزئیات تأیید", occurredAtUtc: "2030-01-02T10:00:00Z" },
      { id: 22, actorUserId: null, actorDisplayName: "System", activityType: "Confirmed", title: "رزرو تأیید نهایی شد", details: null, occurredAtUtc: "2030-01-03T10:00:00Z" },
    ]);
    show({ showAdminActivities: true, reservation: { ...item, status: "ApprovedAwaitingPayment", timeline: [
      { type: "Approved", timestampUtc: "2030-01-02T10:00:00Z" },
    ] } });
    tab("فعالیت‌ها و یادداشت‌ها");
    const history = await screen.findByRole("list", { name: "سابقه فعالیت‌ها" });
    expect(within(history).getAllByText("آماده‌سازی برای پرداخت")).toHaveLength(1);
    expect(within(history).getByText("تأیید واقعی درخواست")).toBeTruthy();
    expect(within(history).getByText("رزرو تأیید نهایی شد")).toBeTruthy();
    expect(within(history).getByText("جزئیات آماده‌سازی")).toBeTruthy();
    expect(within(history).getByText("سیستم")).toBeTruthy();
    expect(history.querySelector('[aria-hidden="true"]')).toBeNull();
    const journey = screen.getByRole("list", { name: "مسیر رزرو" });
    expect(within(journey).getByText("تایید درخواست")).toBeTruthy();
    expect(within(journey).queryByText("آماده‌سازی برای پرداخت")).toBeNull();
  });

  it.each([true, false, undefined])("uses server preparation capability %s, without a global status transition", capability => {
    show({ onPrepareManualPayment: vi.fn(), reservation: { ...item, canPrepareManualPayment: capability } });
    const actions = screen.queryAllByRole("button", { name: "آماده‌سازی برای پرداخت" });
    expect(actions).toHaveLength(capability ? 1 : 0);
    tab("پرداخت و بازپرداخت");
    expect(screen.queryAllByRole("button", { name: "آماده‌سازی برای پرداخت" })).toHaveLength(capability ? 1 : 0);
    expect(screen.queryByRole("button", { name: "تایید رزرو" })).toBeNull();
  });

  it("omits a capability action without its authorized handler", () => {
    show({ reservation: { ...item, canPrepareManualPayment: true } });
    expect(screen.queryByRole("button", { name: "آماده‌سازی برای پرداخت" })).toBeNull();
  });

  it("does not offer payment actions for an expired reservation", () => {
    show({ onCreateManualPayment: vi.fn(), onSendPaymentLink: vi.fn(), reservation: {
      ...item, status: "ApprovedAwaitingPayment", isPaymentExpired: true,
    } });
    tab("پرداخت و بازپرداخت");
    expect(screen.queryByRole("button", { name: "ثبت پرداخت دستی" })).toBeNull();
    expect(screen.queryByRole("button", { name: "ارسال لینک پرداخت" })).toBeNull();
  });

  it("offers one existing manual payment action as the next step and keeps the link secondary", async () => {
    const payment = vi.fn(), link = vi.fn();
    show({ onCreateManualPayment: payment, onSendPaymentLink: link, reservation: {
      ...item, status: "ApprovedAwaitingPayment", isPaymentExpired: false,
      paymentExpiresAtUtc: "2099-01-01T00:00:00Z", remainingPaymentSeconds: 3600,
    } });
    const header = screen.getByRole("heading", { level: 1 }).closest("header")!;
    expect(within(header).getByRole("button", { name: "ثبت دریافت برای این رزرو" }).className).toContain("bg-primary");
    tab("پرداخت و بازپرداخت");
    expect(screen.getAllByRole("button", { name: "ثبت دریافت برای این رزرو" })).toHaveLength(1);
    const sendLink = screen.getByRole("button", { name: "ارسال لینک پرداخت" });
    expect(sendLink.className).not.toContain("bg-primary");
    fireEvent.click(sendLink);
    const confirmation = await screen.findByRole("alertdialog", { name: "ارسال لینک پرداخت" });
    fireEvent.click(within(confirmation).getByRole("button", { name: "ارسال لینک پرداخت" }));
    await waitFor(() => expect(link).toHaveBeenCalledOnce());
    expect(payment).not.toHaveBeenCalled();
  });

  it("keeps order settlement explicitly order-level, separate from reservation amounts", async () => {
    request.mockResolvedValue({ sessionCode: "ORDER-8", currency: "IRR", totalAmount: 3000,
      remainingAmount: 2000, canSettle: false, unavailableReason: "سفارش دارای پرداخت جزئی است." });
    show({ onOrderSettled: vi.fn(), reservation: { ...item, status: "Confirmed", bookingSessionId: 8,
      bookingSessionCode: "ORDER-8", linkedReservationCount: 3 } });
    const header = screen.getByRole("heading", { level: 1 }).closest("header")!;
    expect(within(header).getByText("ORDER-۸")).toBeTruthy();
    expect(within(header).queryByRole("button", { name: "ثبت تسویهٔ کل سفارش" })).toBeNull();
    tab("پرداخت و بازپرداخت");
    fireEvent.click(screen.getByRole("button", { name: "ثبت دریافت کل ماندهٔ سفارش" }));
    const orderDialog = await screen.findByRole("dialog", { name: "ثبت دریافت کل ماندهٔ سفارش" });
    expect(await within(orderDialog).findByText("سفارش دارای پرداخت جزئی است.")).toBeTruthy();
    expect(request).toHaveBeenCalledWith("/admin/manual-payments/orders/8");
    expect(screen.queryByRole("button", { name: "تأیید دریافت کل مانده و ثبت تسویه" })).toBeNull();
  });

  it("shows cancelled amounts as history, with recorded reason and refund actions only", () => {
    show({ onRefund: vi.fn(), onOrderSettled: vi.fn(), onCreateManualPayment: vi.fn(), onCancel: vi.fn(),
      reservation: { ...item, status: "Cancelled", bookingSessionId: 8, cancellationReason: "GuestRequest",
        cancellationFinancial: { paidCancellation: true, currency: "IRR", grossPaidAmount: 500,
          mode: "AutomaticFullRefundV1", guestRefundAmount: 500, finalPropertyShare: 0, finalKoochShare: 0,
          refundPending: true, alreadyHandledByLegacyRefundV1: false }, allowedStatusTransitions: [] } });
    const header = screen.getByRole("heading", { level: 1 }).closest("header")!;
    expect(within(header).getByText("دلیل لغو")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "ثبت پرداخت دستی" })).toBeNull();
    tab("پرداخت و بازپرداخت");
    expect(screen.getByText("این مبالغ سوابق مالی رزرو لغوشده‌اند؛ ماندهٔ تاریخی قابل وصول نیست. تخصیص بازپرداخت به معنی اجرای آن نیست.")).toBeTruthy();
    fireEvent.click(screen.getByText("ریز محاسبات رزرو و لغو", { selector: "summary" }));
    expect(screen.getByText("مبلغ قابل پرداخت (سابقه)")).toBeTruthy();
    expect(screen.getByText("ماندهٔ ثبت‌شده (سابقه)")).toBeTruthy();
    expect(screen.queryByText("باقی‌مانده", { exact: true })).toBeNull();
    expect(within(screen.getByRole("region", { name: "خلاصه مالی این رزرو" })).getByText("بازپرداخت نقدی در انتظار انجام")).toBeTruthy();
    expect(screen.getByRole("button", { name: "ثبت بازپرداخت" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "ثبت تسویهٔ کل سفارش" })).toBeNull();
    expect(screen.queryByText("اقدامات بیشتر")).toBeNull();
  });

  it("keeps cancellation and support requests distinct in More actions with the existing dialog", async () => {
    const cancel = vi.fn(), support = vi.fn();
    show({ onCancel: cancel, onCreateCancellationRequest: support });
    const more = screen.getByText("اقدامات بیشتر", { selector: "summary" });
    fireEvent.click(more);
    expect(screen.getByRole("button", { name: "ثبت درخواست لغو از طرف مهمان" })).toBeTruthy();
    const trigger = screen.getByRole("button", { name: "لغو رزرو" });
    trigger.focus(); fireEvent.click(trigger);
    const dialog = await screen.findByRole("dialog", { name: "لغو رزرو R-TEST-37" });
    expect(within(dialog).getByRole("region", { name: "خلاصه رزرو" })).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "انصراف" }));
    await waitFor(() => expect(document.activeElement).toBe(trigger));
    expect(cancel).not.toHaveBeenCalled(); expect(support).not.toHaveBeenCalled();
    fireEvent.keyDown(more, { key: "Escape" });
    expect(more.closest("details")?.open).toBe(false);
    expect(document.activeElement).toBe(more);
  });

  it("merges repeated activity IDs without dropping unique details or unrelated timeline records", async () => {
    request.mockResolvedValue([
      { id: 4, actorDisplayName: "مدیر", actorUserId: 1, activityType: "Updated", title: "رویداد مشترک", details: "جزئیات اول", occurredAtUtc: "2030-01-01T10:00:00Z" },
      { id: 4, actorDisplayName: "مدیر", actorUserId: 1, activityType: "Updated", title: "رویداد مشترک", details: "جزئیات دوم", occurredAtUtc: "2030-01-01T10:00:00Z" },
      { id: 5, actorDisplayName: "مدیر", actorUserId: 1, activityType: "Updated", title: "رویداد مستقل", details: "جزئیات مستقل", occurredAtUtc: "2030-01-01T10:00:00Z" },
    ]);
    show({ showAdminActivities: true, canAddInternalNote: true, reservation: {
      ...item, timeline: [{ type: "Updated", timestampUtc: "2030-01-01T10:00:00Z", note: "اطلاعات خط زمانی" }],
    } });
    tab("فعالیت‌ها و یادداشت‌ها");
    expect(await screen.findAllByText("رویداد مشترک")).toHaveLength(1);
    expect(screen.getByText(/جزئیات اول/).textContent).toContain("جزئیات دوم");
    expect(screen.getByText("رویداد مستقل")).toBeTruthy();
    expect(screen.getByText("اطلاعات خط زمانی")).toBeTruthy();
    expect(screen.getByLabelText("یادداشت داخلی")).toBeTruthy();
  });
});
