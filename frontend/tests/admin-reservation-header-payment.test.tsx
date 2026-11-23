import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ReservationDetailsDialog } from "@/components/reservations/ReservationDetailsDialog";
import type { ReservationTableItem } from "@/components/reservations/ReservationTable";

const request = vi.hoisted(() => vi.fn());
vi.mock("@/lib/owner-api", () => ({ apiRequest: request }));
vi.mock("@/lib/currency", async original => ({ ...(await original<typeof import("@/lib/currency")>()), useSiteCurrencyLabel: () => "ریال" }));
const item: ReservationTableItem = {
  id: 37, reservationNumber: "R-37", propertyName: "اقامتگاه آزمون", source: "AdminCreated",
  status: "ApprovedAwaitingPayment", currency: "IRR", finalAmount: 1000, remainingAmount: 1000,
  paymentExpiresAtUtc: "2099-01-01T12:00:00Z", remainingPaymentSeconds: 600,
  checkInDate: "2099-02-01", checkOutDate: "2099-02-03", allowedStatusTransitions: [],
};
const link = { reservationId: 37, paymentLink: "/account/reservations/R-37/payment?token=Exact%2BToken&next=a%20b", expiresAtUtc: "2099-01-01T12:00:00Z" };
const writeText = vi.fn().mockResolvedValue(undefined);
beforeEach(() => {
  request.mockReset(); writeText.mockClear();
  vi.stubGlobal("navigator", { clipboard: { writeText } });
});
afterEach(() => vi.unstubAllGlobals());
function show(reservation = item, paymentLink: typeof link | null = link) {
  return render(<ReservationDetailsDialog presentation="page" open reservation={reservation} paymentLink={paymentLink} onOpenChange={vi.fn()} />);
}

it("shows the deadline, existing countdown and exact link in the shared header without a tab switch or request", async () => {
  show();
  const header = screen.getByRole("heading", { level: 1 }).closest("header")!;
  const info = within(header).getByRole("region", { name: "اطلاعات پرداخت رزرو" });
  expect(within(info).getAllByText("مهلت پرداخت:")).toHaveLength(1);
  expect(within(info).getAllByText("زمان باقی‌مانده:")).toHaveLength(1);
  expect(info.textContent).toContain("۱۰:۰۰");
  expect(within(info).getByRole("link").getAttribute("href")).toBe(link.paymentLink);
  expect(within(info).getByRole("link").textContent).toBe(link.paymentLink);
  expect(screen.getByRole("tab", { name: "رزرو و مهمان" }).getAttribute("aria-selected")).toBe("true");
  fireEvent.click(within(info).getByRole("button", { name: "کپی لینک" }));
  await waitFor(() => expect(writeText).toHaveBeenCalledExactlyOnceWith(link.paymentLink));
  expect(await within(info).findByRole("status")).toHaveProperty("textContent", "لینک کپی شد.");
  expect(request).not.toHaveBeenCalled();
});

it("shows the no-link message while preserving the deadline and does not create a link", () => {
  show(item, null);
  const info = screen.getByRole("region", { name: "اطلاعات پرداخت رزرو" });
  expect(within(info).getByText("لینک پرداخت ایجاد نشده")).toBeTruthy();
  expect(within(info).getByText("مهلت پرداخت:")).toBeTruthy();
  expect(within(info).queryByRole("button", { name: "کپی لینک" })).toBeNull();
  expect(request).not.toHaveBeenCalled();
});

it("does not claim an old link was never created when history records it but its URL is unavailable", () => {
  show({ ...item, timeline: [{ type: "PaymentLinkCreated", timestampUtc: "2098-12-31T12:00:00Z" }] }, null);
  expect(screen.getByText("لینک پرداخت قبلی در اطلاعات فعلی در دسترس نیست.")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "کپی لینک" })).toBeNull();
});

it.each(["Pending", "Confirmed", "Cancelled", "PaymentExpired"] as const)("hides header payment information for %s", status => {
  show({ ...item, status });
  expect(screen.queryByRole("region", { name: "اطلاعات پرداخت رزرو" })).toBeNull();
  expect(screen.queryByRole("button", { name: "کپی لینک" })).toBeNull();
});

it.each([
  { ...link, expiresAtUtc: "2000-01-01T00:00:00Z" },
  { ...link, expiresAtUtc: "invalid" },
  { ...link, paymentLink: "javascript:alert(1)" },
  { ...link, paymentLink: "//other.test/payment" },
  { ...link, reservationId: 38 },
])("does not expose an expired, invalid or unrelated link as usable (%j)", invalidLink => {
  show(item, invalidLink);
  const info = screen.getByRole("region", { name: "اطلاعات پرداخت رزرو" });
  expect(within(info).queryByRole("link")).toBeNull();
  expect(within(info).queryByRole("button", { name: "کپی لینک" })).toBeNull();
  expect(request).not.toHaveBeenCalled();
});

it("does not offer a link after the reservation deadline expires", () => {
  show({ ...item, remainingPaymentSeconds: 0, isPaymentExpired: true });
  const info = screen.getByRole("region", { name: "اطلاعات پرداخت رزرو" });
  expect(within(info).getByText("مهلت پرداخت تمام شده است.")).toBeTruthy();
  expect(within(info).queryByRole("link")).toBeNull();
  expect(within(info).queryByRole("button", { name: "کپی لینک" })).toBeNull();
});
