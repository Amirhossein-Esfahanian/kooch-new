import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { ReservationDetailsDialog } from "@/components/reservations/ReservationDetailsDialog";
import type { ReservationTableItem } from "@/components/reservations/ReservationTable";

const api = vi.hoisted(() => vi.fn());
vi.mock("@/lib/owner-api", () => ({ apiRequest: api }));
vi.mock("@/lib/currency", async original => ({ ...(await original<typeof import("@/lib/currency")>()), useSiteCurrencyLabel: () => "ریال" }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), warning: vi.fn() } }));
const reservation: ReservationTableItem = {
  id: 37, reservationNumber: "R-37", propertyName: "اقامتگاه آزمون", source: "AdminCreated",
  status: "ApprovedAwaitingPayment", currency: "IRR", finalAmount: 1000, remainingAmount: 1000,
  bookingSessionId: 9, bookingSessionCode: "O-9", linkedReservationCount: 1,
  checkInDate: "2030-02-01", checkOutDate: "2030-02-03", allowedStatusTransitions: [],
};
const balance = { bookingSessionId: 9, sessionCode: "O-9", currency: "IRR", totalAmount: 1000,
  remainingAmount: 1000, canSettle: true, unavailableReason: null, reservationCount: 1,
  reservations: [{ reservationId: 37, reservationNumber: "R-37", remainingAmount: 1000, allocationAmount: 1000 }] };
function show(item = reservation, payment = vi.fn().mockResolvedValue(undefined), settled = vi.fn()) {
  render(<ReservationDetailsDialog presentation="page" open onOpenChange={vi.fn()} reservation={item}
    onCreateManualPayment={payment} onOrderSettled={settled} />);
  return { payment, settled };
}
beforeEach(() => { api.mockReset(); api.mockResolvedValue(balance); });

it("defaults a verified single-reservation order to the review receipt and preserves collapsed optional values", async () => {
  const { payment } = show();
  expect(screen.getAllByRole("button", { name: "ثبت دریافت وجه" })).toHaveLength(1);
  expect(screen.queryByRole("button", { name: "ثبت دریافت کل ماندهٔ سفارش" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "ثبت دریافت وجه" }));
  const dialog = await screen.findByRole("dialog", { name: "ثبت پرداخت دستی" });
  expect(within(dialog).getByText(/این رسید برای بررسی ثبت می‌شود/)).toBeTruthy();
  const optional = within(dialog).getByText("جزئیات اختیاری", { selector: "summary" });
  expect(optional.closest("details")?.open).toBe(false);
  fireEvent.click(optional);
  fireEvent.change(within(dialog).getByLabelText("بانک مقصد"), { target: { value: "بانک آزمون" } });
  fireEvent.click(optional);
  expect(optional.closest("details")?.open).toBe(false);
  fireEvent.click(within(dialog).getByRole("button", { name: "ثبت پرداخت" }));
  await waitFor(() => expect(payment).toHaveBeenCalledOnce());
  expect(payment.mock.calls[0][0]).toBe(reservation);
  expect(payment.mock.calls[0][1]).toMatchObject({ amount: 1000, currency: "IRR", destinationBank: "بانک آزمون" });
  expect(api).not.toHaveBeenCalled();
});

it("offers full-order confirmed recording only as an explicit alternative, with its existing separate handler", async () => {
  const { payment, settled } = show();
  fireEvent.click(screen.getByRole("button", { name: "ثبت دریافت وجه" }));
  fireEvent.click(within(await screen.findByRole("dialog", { name: "ثبت پرداخت دستی" })).getByRole("button", { name: "ثبت دریافت کل ماندهٔ سفارش" }));
  const order = await screen.findByRole("dialog", { name: "ثبت دریافت کل ماندهٔ سفارش" });
  await within(order).findByText(/رسید کل سفارش با تخصیص/);
  expect(within(order).getByRole("link", { name: "R-37" }).getAttribute("href")).toBe("/admin/reservations/37");
  expect(payment).not.toHaveBeenCalled();
  expect(api.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
  fireEvent.click(within(order).getByRole("button", { name: "تأیید دریافت کل مانده و ثبت تسویه" }));
  await waitFor(() => expect(settled).toHaveBeenCalledOnce());
  const writes = api.mock.calls.filter(([, init]) => init?.method === "POST");
  expect(writes).toHaveLength(1);
  expect(writes[0][0]).toBe("/admin/manual-payments/orders/9/settle");
  expect(JSON.parse(writes[0][1].body)).toMatchObject({ confirmedAmount: 1000, currency: "IRR" });
  expect(payment).not.toHaveBeenCalled();
});

it("distinguishes multi-reservation scope and displays only the server's positive allocations", async () => {
  api.mockResolvedValue({ ...balance, reservationCount: 3, totalAmount: 2500, remainingAmount: 1500, reservations: [
    ...balance.reservations,
    { reservationId: 38, reservationNumber: "R-38", remainingAmount: 500, allocationAmount: 500 },
    { reservationId: 39, reservationNumber: "R-39", remainingAmount: 0, allocationAmount: 0 },
  ] });
  show({ ...reservation, linkedReservationCount: 3, roomCount: 99 });
  expect(screen.getByText(/این رزرو یکی از ۳ رزرو سفارش/)).toBeTruthy();
  expect(screen.getByRole("button", { name: "ثبت دریافت برای این رزرو" })).toBeTruthy();
  fireEvent.click(screen.getByRole("tab", { name: "پرداخت و بازپرداخت" }));
  expect(screen.getByText(/دریافت تک‌رزرو فقط برای/).textContent).toContain("R-37");
  fireEvent.click(screen.getByRole("button", { name: "ثبت دریافت کل ماندهٔ سفارش" }));
  const order = await screen.findByRole("dialog", { name: "ثبت دریافت کل ماندهٔ سفارش" });
  const allocations = await within(order).findByRole("region", { name: "تخصیص دریافت به رزروها" });
  expect(within(allocations).getAllByRole("link")).toHaveLength(2);
  expect(within(allocations).queryByRole("link", { name: "R-39" })).toBeNull();
  expect(within(order).getByText(/کل مانده:/).textContent).toContain("۱٬۵۰۰");
});

it("does not infer a single-reservation order from a missing membership count or balance", () => {
  show({ ...reservation, linkedReservationCount: undefined, roomCount: 1 });
  expect(screen.getByText(/تعداد رزروهای سفارش مشخص نیست/)).toBeTruthy();
  expect(screen.queryByRole("button", { name: "ثبت دریافت وجه" })).toBeNull();
  expect(screen.getByRole("button", { name: "ثبت دریافت برای این رزرو" })).toBeTruthy();
  expect(screen.queryByText(/این رزرو یکی از/)).toBeNull();
});

it("does not present an incomplete preview as a complete allocation list", async () => {
  api.mockResolvedValue({ ...balance, reservationCount: 3 });
  show({ ...reservation, linkedReservationCount: 3 });
  fireEvent.click(screen.getByRole("tab", { name: "پرداخت و بازپرداخت" }));
  fireEvent.click(screen.getByRole("button", { name: "ثبت دریافت کل ماندهٔ سفارش" }));
  expect(await screen.findByText("ریز کامل تخصیص رزروهای سفارش در پاسخ سرور موجود نیست.")).toBeTruthy();
  expect(screen.queryByRole("region", { name: "تخصیص دریافت به رزروها" })).toBeNull();
});

it("does not offer either receipt without the existing authorized handlers", () => {
  render(<ReservationDetailsDialog presentation="page" open onOpenChange={vi.fn()} reservation={reservation} />);
  fireEvent.click(screen.getByRole("tab", { name: "پرداخت و بازپرداخت" }));
  expect(screen.queryByRole("button", { name: /ثبت دریافت/ })).toBeNull();
});
