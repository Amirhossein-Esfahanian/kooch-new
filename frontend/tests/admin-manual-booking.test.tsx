import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { ManualReservationDialog } from "@/components/reservations/ManualReservationDialog";

const mocks = vi.hoisted(() => ({ api: vi.fn(), error: vi.fn(), success: vi.fn() }));
vi.mock("@/lib/owner-api", async importOriginal => ({
  ...await importOriginal<typeof import("@/lib/owner-api")>(), apiRequest: mocks.api,
}));
vi.mock("sonner", () => ({ toast: { error: mocks.error, success: mocks.success } }));
vi.mock("@/components/KoochDatePicker", () => ({ KoochDatePicker: ({ onChange }: {
  onChange: (value: { startDate: string; endDate: string }) => void;
}) => <button type="button" onClick={() => onChange({ startDate: "2035-02-01", endDate: "2035-02-03" })}>انتخاب تاریخ آزمون</button> }));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.api.mockImplementation(async (path: string) => {
    if (path === "/admin/properties") return [{ id: 10, name: "اقامتگاه آزمون" }];
    if (path.startsWith("/admin/guests")) return [{ id: 40, firstName: "مهمان", lastName: "آزمون", mobile: "09123456789" }];
    if (path.startsWith("/admin/reservations/available-rooms")) return [30, 32, 33].map(roomId => ({
      roomId, roomTypeId: 20, roomName: `اتاق ${roomId}`, baseCapacity: 2,
      bookingMode: "Instant", extraGuestAllowed: false, maxExtraGuests: 0,
    }));
    if (path.startsWith("/admin/reservations/effective-rules")) return {
      propertyId: 10, roomTypeId: 20, baseCapacity: 2, maxDeclaredChildren: 0,
      extraGuestAllowed: false, maxExtraGuests: 0, childRate: 0, ruleSource: "SiteDefault",
    };
    if (path === "/admin/reservations/price-preview") return {
      nightsCount: 2, roomCount: 3, baseAmount: 600, finalAmount: 600, currency: "IRR",
      childAmount: 0, extraGuestAmount: 0, discountAmount: 0,
    };
    if (path === "/admin/reservations") return {
      bookingSessionId: 15, sessionCode: "O-123456", totalAmount: 600, currency: "IRR",
      reservations: [30, 32, 33].map((roomId, index) => ({ id: index + 50,
        reservationNumber: `R-${100000 + index}`, roomName: `اتاق ${roomId}`, roomTypeName: "دبل", finalAmount: 200 })),
    };
    throw new Error(`Unexpected ${path}`);
  });
});

it("creates all selected rooms and shows every reservation and the authoritative order total", async () => {
  const refresh = vi.fn();
  render(<ManualReservationDialog context="admin" fixedPropertyId={10} onCreated={refresh} />);
  fireEvent.click(screen.getByRole("button", { name: "افزودن رزرو" }));
  fireEvent.click(await screen.findByRole("button", { name: "انتخاب تاریخ آزمون" }));
  fireEvent.click(screen.getByRole("button", { name: "انتخاب مهمان" }));
  fireEvent.change(await screen.findByPlaceholderText("نام، موبایل یا ایمیل"), { target: { value: "آزمون" } });
  fireEvent.click(await screen.findByRole("button", { name: /مهمان آزمون/ }));
  const rooms = screen.getByRole("button", { name: /^اتاق/ });
  await waitFor(() => expect((rooms as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(rooms);
  fireEvent.click(await screen.findByRole("button", { name: /انتخاب همه/ }));
  fireEvent.click(rooms);
  await waitFor(() => expect((screen.getByRole("button", { name: "ثبت رزرو" }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.submit(document.getElementById("manual-reservation-form")!);
  fireEvent.click(await screen.findByRole("button", { name: "تایید و ایجاد رزرو" }));
  const result = await screen.findByRole("dialog", { name: "سفارش دستی ثبت شد" });
  expect(within(result).getByText("O-123456")).toBeTruthy();
  expect(within(result).getByText(/مبلغ کل سفارش/).textContent).toContain("۶۰۰");
  expect(within(result).getAllByRole("link").map(link => link.getAttribute("href"))).toEqual([
    "/admin/reservations?reservationId=50", "/admin/reservations?reservationId=51", "/admin/reservations?reservationId=52",
  ]);
  expect(refresh).toHaveBeenCalledOnce();
  const creates = mocks.api.mock.calls.filter(([path, options]) => path === "/admin/reservations" && options?.method === "POST");
  expect(creates).toHaveLength(1);
  expect(JSON.parse(creates[0][1].body).roomIds).toEqual([30, 32, 33]);
  expect(mocks.error).not.toHaveBeenCalled();
});
