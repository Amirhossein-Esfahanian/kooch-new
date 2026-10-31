import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ManualReservationDialog } from "@/components/reservations/ManualReservationDialog";
import type { ReservationTableItem } from "@/components/reservations/ReservationTable";

const mocks = vi.hoisted(() => ({
  api: vi.fn(), error: vi.fn(), success: vi.fn(),
}));

vi.mock("@/lib/owner-api", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/owner-api")>(),
  apiRequest: mocks.api,
}));
vi.mock("sonner", () => ({ toast: { error: mocks.error, success: mocks.success } }));
vi.mock("@/lib/currency", () => ({
  formatCurrency: (value: number) => String(value),
  useSiteCurrencyLabel: () => "تومان",
}));

function reservation(overrides: Partial<ReservationTableItem> = {}): ReservationTableItem {
  return {
    id: 12, reservationNumber: "R-12", propertyId: 10, propertyName: "اقامتگاه آزمون",
    roomTypeId: 20, roomTypeName: "اتاق دبل", roomId: 30, roomName: "اتاق یک",
    guestId: null, guestFullName: "مسافر ثبت‌شده", guestMobile: null,
    guestEmail: "booked@example.test", guestNationalCode: "1234567891",
    checkInDate: "2030-10-20", checkOutDate: "2030-10-22",
    adults: 1, children: 0, roomCount: 1, status: "Pending", finalAmount: 100,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("matchMedia", vi.fn(() => ({
    matches: false, media: "", onchange: null,
    addListener: vi.fn(), removeListener: vi.fn(),
    addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn(),
  })));
  mocks.api.mockImplementation(async (path: string) => {
    if (path === "/admin/properties") return [{ id: 10, name: "اقامتگاه آزمون" }];
    if (path.startsWith("/admin/reservations/effective-rules")) return {
      propertyId: 10, roomTypeId: 20, baseCapacity: 2, maxDeclaredChildren: 2,
      extraGuestAllowed: false, maxExtraGuests: 0, extraGuestPrice: 0,
      freeChildMaxAge: null, halfPriceChildMinAge: null, halfPriceChildMaxAge: null,
      childPrice: null, childRate: 0, ruleSource: "Property",
    };
    if (path.startsWith("/admin/reservations/available-rooms")) return [{
      roomId: 30, roomName: "اتاق یک", roomTypeId: 20, baseCapacity: 2,
      bookingMode: "Instant", extraGuestAllowed: false, maxExtraGuests: 0,
    }];
    if (path === "/admin/reservations/price-preview") return {
      nightsCount: 2, roomCount: 1, baseAmount: 100, childAmount: 0,
      extraGuestAmount: 0, discountAmount: 0, finalAmount: 100, currency: "IRR",
    };
    if (path === "/admin/reservations/12") return {};
    throw new Error(`Unexpected API request: ${path}`);
  });
});

describe("manual reservation traveler compatibility", () => {
  it.each([null, 40])("edits without Guest lookup/reassignment and preserves GuestId %s", async (guestId) => {
    const onCreated = vi.fn();
    render(<ManualReservationDialog context="admin" mode="edit" open
      onCreated={onCreated} onOpenChange={vi.fn()} reservation={reservation({ guestId })} />);
    const traveler = await screen.findByRole("region", { name: "اطلاعات مهمان ثبت‌شده" });
    expect(within(traveler).getByText("مسافر ثبت‌شده")).toBeTruthy();
    expect(within(traveler).getByText("booked@example.test")).toBeTruthy();
    expect(within(traveler).getByText("1234567891")).toBeTruthy();
    expect(within(traveler).queryByText("موبایل")).toBeNull();
    expect(within(traveler).queryByRole("textbox")).toBeNull();
    expect(screen.queryByText("انتخاب مهمان")).toBeNull();
    expect(screen.queryByRole("button", { name: "افزودن مهمان" })).toBeNull();
    await waitFor(() => expect(mocks.api.mock.calls.some(([path]) =>
      path === "/admin/reservations/price-preview")).toBe(true));
    await waitFor(() => expect((screen.getByRole("button", { name: "ذخیره تغییرات" }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.change(screen.getByLabelText("یادداشت داخلی"), { target: { value: "یادداشت جدید" } });
    fireEvent.submit(document.getElementById("manual-reservation-form")!);
    fireEvent.click(await screen.findByRole("button", { name: "تایید و ذخیره" }));
    await waitFor(() => expect(onCreated).toHaveBeenCalledOnce());
    const update = mocks.api.mock.calls.find(([path, options]) =>
      path === "/admin/reservations/12" && options?.method === "PUT");
    expect(update).toBeTruthy();
    const payload = JSON.parse(update![1].body);
    expect(payload.guestId).toBe(guestId);
    expect(payload.notes).toBe("یادداشت جدید");
    expect(payload.roomTypeId).toBe(20);
    expect(payload.roomIds).toEqual([30]);
    expect(payload.adults).toBe(1);
    expect(payload.checkInDate).toBe("2030-10-20");
    expect(payload.checkOutDate).toBe("2030-10-22");
    expect(Object.keys(payload).some(key => /snapshot|guestName|guestEmail|nationalCode/i.test(key))).toBe(false);
    expect(mocks.api.mock.calls.some(([path]) => path.startsWith("/admin/guests"))).toBe(false);
    expect(mocks.error).not.toHaveBeenCalled();
  });

  it("keeps paid reservation traveler read-only during notes-only editing", async () => {
    render(<ManualReservationDialog context="admin" mode="edit" open
      onCreated={vi.fn()} reservation={reservation({ status: "Paid" })} />);
    expect(await screen.findByRole("region", { name: "اطلاعات مهمان ثبت‌شده" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "افزودن مهمان" })).toBeNull();
    expect(screen.queryByText("انتخاب مهمان")).toBeNull();
  });

  it("preserves Guest selection and validation for manual creation", async () => {
    render(<ManualReservationDialog context="admin" fixedPropertyId={10} onCreated={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "افزودن رزرو" }));
    expect(await screen.findByText("انتخاب مهمان")).toBeTruthy();
    expect(await screen.findByRole("button", { name: "افزودن مهمان" })).toBeTruthy();
    expect(screen.queryByRole("region", { name: "اطلاعات مهمان ثبت‌شده" })).toBeNull();
    fireEvent.submit(document.getElementById("manual-reservation-form")!);
    expect(mocks.error).toHaveBeenCalledWith("اقامتگاه و مهمان را انتخاب کنید.");
    expect(mocks.api.mock.calls.some(([, options]) => options?.method === "POST")).toBe(false);
  });
});
