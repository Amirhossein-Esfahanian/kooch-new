import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { ManualReservationDialog } from "@/components/reservations/ManualReservationDialog";
import { ManualOrderSettlement } from "@/components/reservations/ManualOrderSettlement";
import { ReservationDetailsDialog } from "@/components/reservations/ReservationDetailsDialog";
import { ApiRequestError } from "@/lib/owner-api";

const mocks = vi.hoisted(() => ({ api: vi.fn(), error: vi.fn(), success: vi.fn(), warning: vi.fn() }));
vi.mock("@/lib/owner-api", async importOriginal => ({
  ...await importOriginal<typeof import("@/lib/owner-api")>(), apiRequest: mocks.api,
}));
vi.mock("sonner", () => ({ toast: { error: mocks.error, success: mocks.success, warning: mocks.warning } }));
vi.mock("@/lib/currency", async importOriginal => ({
  ...await importOriginal<typeof import("@/lib/currency")>(), useSiteCurrencyLabel: () => "تومان",
}));
vi.mock("@/components/KoochDatePicker", () => ({ KoochDatePicker: ({ onChange }: {
  onChange: (value: { startDate: string; endDate: string }) => void;
}) => <><button type="button" onClick={() => onChange({ startDate: "2035-02-01", endDate: "2035-02-03" })}>انتخاب تاریخ آزمون</button>
  <button type="button" onClick={() => onChange({ startDate: "2035-02-05", endDate: "2035-02-07" })}>انتخاب تاریخ جدید</button></> }));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.api.mockImplementation(async (path: string) => {
    if (path === "/admin/properties") return [{ id: 10, name: "اقامتگاه آزمون" }, { id: 11, name: "اقامتگاه دوم" }];
    if (path.startsWith("/admin/guests")) return [{ id: 40, firstName: "مهمان", lastName: "آزمون", mobile: "09123456789" }];
    if (path.startsWith("/admin/reservations/available-rooms")) return { options: [{
      roomTypeId: 20, name: "دبل", inventoryMode: "NamedRooms", availableCount: 3, bookingMode: "Instant",
      rooms: [30, 32, 33].map(roomId => ({
      id: roomId, roomTypeId: 20, name: `اتاق ${roomId}`, capacity: 2,
      bookingMode: "Instant", allowExtraGuest: false, maxExtraGuests: 0,
    })) }], excluded: [] };
    if (path.startsWith("/admin/reservations/effective-rules")) return {
      propertyId: 10, roomTypeId: 20, baseCapacity: 2, maxDeclaredChildren: 0,
      extraGuestAllowed: false, maxExtraGuests: 0, childRate: 0, ruleSource: "SiteDefault",
    };
    if (path === "/admin/reservations/price-preview") return {
      nightsCount: 2, roomCount: 3, baseAmount: 600, finalAmount: 600, currency: "IRR",
      childAmount: 0, extraGuestAmount: 0, discountAmount: 0,
      roomPrices: [1, 1, 1].map(adults => ({ adults, children: 0, finalAmount: 200, currency: "IRR" })),
    };
    if (path === "/admin/reservations") return {
      bookingSessionId: 15, sessionCode: "O-123456", totalAmount: 600, currency: "IRR",
      reservations: [30, 32, 33].map((roomId, index) => ({ id: index + 50,
        reservationNumber: `R-${100000 + index}`, propertyId: 10, roomName: `اتاق ${roomId}`, roomTypeName: "دبل", finalAmount: 200 })),
    };
    throw new Error(`Unexpected ${path}`);
  });
});

it("does not disguise a failed availability request as empty inventory", async () => {
  const original = mocks.api.getMockImplementation()!;
  mocks.api.mockImplementation((path: string, ...args: unknown[]) => path.startsWith("/admin/reservations/available-rooms")
    ? Promise.reject(new Error("Availability service unavailable")) : original(path, ...args));
  await openStay();
  fireEvent.click(screen.getByRole("button", { name: "انتخاب اتاق‌ها" }));
  expect(await screen.findByText("Availability service unavailable")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "بررسی نهایی" })).toBeNull();
  mocks.api.mockImplementation(original);
  fireEvent.click(screen.getByRole("button", { name: "تلاش دوباره برای دریافت اتاق‌ها" }));
  expect(await screen.findByRole("button", { name: /^اتاق/ })).toBeTruthy();
  expect(screen.queryByText("Availability service unavailable")).toBeNull();
});

async function openStay(onCreated = vi.fn(), fixedPropertyId: number | null = 10, onReviewCreatedReservation?: (id: number) => void,
  canReviewCreatedReservation = (_propertyId: number) => true, canReceive = false) {
  render(<ManualReservationDialog context="admin" fixedPropertyId={fixedPropertyId ?? undefined} onCreated={onCreated}
    onReviewCreatedReservation={onReviewCreatedReservation} canReviewCreatedReservation={canReviewCreatedReservation}
    canRecordReceivedPayment={() => canReceive} />);
  fireEvent.click(screen.getByRole("button", { name: "افزودن رزرو" }));
  if (fixedPropertyId === null) {
    fireEvent.click(await screen.findByRole("button", { name: /^اقامتگاه/ }));
    fireEvent.click(await screen.findByRole("button", { name: "اقامتگاه آزمون" }));
  }
  fireEvent.click(await screen.findByRole("button", { name: "انتخاب تاریخ آزمون" }));
  fireEvent.click(screen.getByRole("button", { name: "انتخاب مهمان" }));
  fireEvent.change(await screen.findByPlaceholderText("نام، موبایل یا ایمیل"), { target: { value: "آزمون" } });
  fireEvent.click(await screen.findByRole("button", { name: /مهمان آزمون/ }));
  fireEvent.click(screen.getByRole("button", { name: "افزایش بزرگسالان" }));
  fireEvent.click(screen.getByRole("button", { name: "افزایش بزرگسالان" }));
}

async function selectRooms() {
  fireEvent.click(screen.getByRole("button", { name: "انتخاب اتاق‌ها" }));
  const rooms = await screen.findByRole("button", { name: /^اتاق/ });
  await waitFor(() => expect((rooms as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(rooms);
  fireEvent.click(await screen.findByRole("button", { name: /انتخاب همه/ }));
  fireEvent.click(rooms);
  await waitFor(() => expect((screen.getByRole("button", { name: "بررسی نهایی" }) as HTMLButtonElement).disabled).toBe(false));
}

it("keeps API currency and amounts consistent from preview through creation and settlement despite a toman site label", async () => {
  const original = mocks.api.getMockImplementation()!;
  mocks.api.mockImplementation(async (path: string, ...args: unknown[]) => {
    if (path === "/admin/manual-payments/orders/15") return { sessionCode: "O-123456", currency: "IRR",
      totalAmount: 5_000_000, remainingAmount: 5_000_000, canSettle: true, unavailableReason: null };
    if (path === "/admin/manual-payments/orders/15/settle") return {};
    const result = await original(path, ...args);
    if (path === "/admin/reservations/price-preview") return { ...result, baseAmount: 5_000_000, finalAmount: 5_000_000,
      roomPrices: result.roomPrices.map((price: object, index: number) => ({ ...price, finalAmount: [2_000_000, 2_000_000, 1_000_000][index] })) };
    if (path === "/admin/reservations") return { ...result, totalAmount: 5_000_000,
      reservations: result.reservations.map((reservation: object, index: number) => ({ ...reservation, finalAmount: [2_000_000, 2_000_000, 1_000_000][index] })) };
    return result;
  });
  await openStay(); await selectRooms();
  expect(screen.getByText(/مبلغ کل:/).textContent).toContain("۵٬۰۰۰٬۰۰۰ ریال");
  expect(screen.getByText(/قیمت پایه:/).textContent).toContain("۵٬۰۰۰٬۰۰۰ ریال");
  expect(screen.queryByText(/تومان/)).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "بررسی نهایی" }));
  expect(screen.getByText("۵٬۰۰۰٬۰۰۰ ریال")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "تایید و ایجاد رزرو" }));
  const result = await screen.findByRole("dialog", { name: "سفارش دستی ثبت شد" });
  expect(within(result).getByText(/مبلغ کل سفارش/).parentElement?.textContent).toContain("۵٬۰۰۰٬۰۰۰ ریال");
  fireEvent.click(within(result).getByText("بستن"));
  render(<ManualOrderSettlement bookingSessionId={15} onSettled={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "ثبت تسویهٔ کل سفارش" }));
  expect((await screen.findByText(/کل مانده:/)).textContent).toContain("۵٬۰۰۰٬۰۰۰ ریال");
  fireEvent.click(await screen.findByRole("button", { name: "تأیید دریافت کل مانده و ثبت تسویه" }));
  await waitFor(() => expect(mocks.api.mock.calls.some(([path]) => path.endsWith("/15/settle"))).toBe(true));
  const receipt = mocks.api.mock.calls.find(([path]) => path.endsWith("/15/settle"))!;
  expect(JSON.parse(receipt[1].body)).toMatchObject({ confirmedAmount: 5_000_000, currency: "IRR" });
});

it("defaults to unchanged unpaid creation even for an authorized receipt actor", async () => {
  await openStay(vi.fn(), 10, undefined, undefined, true); await selectRooms();
  fireEvent.click(screen.getByRole("button", { name: "بررسی نهایی" }));
  expect((screen.getByRole("radio", { name: "ثبت رزرو بدون دریافت وجه" }) as HTMLInputElement).checked).toBe(true);
  expect((screen.getByRole("radio", { name: "ثبت دریافت کامل و تأیید رزرو" }) as HTMLInputElement).checked).toBe(false);
  expect(screen.queryByLabelText("روش دریافت وجه")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "تایید و ایجاد رزرو" }));
  await screen.findByRole("dialog", { name: "سفارش دستی ثبت شد" });
  const payload = JSON.parse(mocks.api.mock.calls.find(([path]) => path === "/admin/reservations")![1].body);
  expect(payload.status).toBe("Pending");
  expect(payload.receivedPayment).toBeUndefined();
  expect(payload.reviewedRoomAmounts).toBeUndefined();
});

it("records a full received receipt only on final submit and shows all confirmed reservation links", async () => {
  const original = mocks.api.getMockImplementation()!;
  mocks.api.mockImplementation(async (path: string, ...args: unknown[]) => {
    const result = await original(path, ...args);
    return path === "/admin/reservations" ? { ...result,
      reservations: result.reservations.map((room: object) => ({ ...room, status: "Confirmed" })) } : result;
  });
  await openStay(vi.fn(), 10, undefined, undefined, true); await selectRooms();
  fireEvent.click(screen.getByRole("button", { name: "بررسی نهایی" }));
  fireEvent.click(screen.getByRole("radio", { name: "ثبت دریافت کامل و تأیید رزرو" }));
  expect(screen.getByText(/از مهمان پول برداشت نمی‌کند/)).toBeTruthy();
  fireEvent.change(screen.getByLabelText("روش دریافت وجه"), { target: { value: "CardToCard" } });
  fireEvent.change(screen.getByLabelText("شماره پیگیری (اختیاری)"), { target: { value: " REF-123 " } });
  expect(mocks.api.mock.calls.filter(([path]) => path === "/admin/reservations")).toHaveLength(0);
  const submit = screen.getByRole("button", { name: "ثبت دریافت کامل و تأیید رزرو" });
  fireEvent.click(submit); fireEvent.click(submit);
  const result = await screen.findByRole("dialog", { name: "سفارش دستی ثبت شد" });
  const calls = mocks.api.mock.calls.filter(([path]) => path === "/admin/reservations");
  expect(calls).toHaveLength(1);
  expect(JSON.parse(calls[0][1].body)).toMatchObject({ status: "Pending", reviewedRoomAmounts: [200, 200, 200],
    receivedPayment: { confirmedAmount: 600, currency: "IRR", method: "CardToCard", referenceNumber: "REF-123",
      idempotencyKey: expect.any(String), paymentDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) } });
  expect(within(result).getAllByText("تأییدشده")).toHaveLength(3);
  expect(within(result).getAllByRole("link")).toHaveLength(3);
  expect(within(result).getByText("O-123456")).toBeTruthy();
  expect(within(result).queryByRole("button", { name: "ثبت دریافت کامل و تأیید رزرو" })).toBeNull();
});

it("does not offer received payment without permission", async () => {
  await openStay(); await selectRooms();
  fireEvent.click(screen.getByRole("button", { name: "بررسی نهایی" }));
  expect(screen.queryByRole("radio", { name: "ثبت دریافت کامل و تأیید رزرو" })).toBeNull();
});

it("keeps OnRequest on its current unpaid flow even with receipt permission", async () => {
  const original = mocks.api.getMockImplementation()!;
  mocks.api.mockImplementation(async (path: string, ...args: unknown[]) => {
    const result = await original(path, ...args);
    return path.startsWith("/admin/reservations/available-rooms") ? { ...result,
      options: result.options.map((option: { rooms: object[] }) => ({ ...option, bookingMode: "OnRequest",
        rooms: option.rooms.map(room => ({ ...room, bookingMode: "OnRequest" })) })) } : result;
  });
  await openStay(vi.fn(), 10, undefined, undefined, true); await selectRooms();
  fireEvent.click(screen.getByRole("button", { name: "بررسی نهایی" }));
  expect(screen.queryByRole("radio", { name: "ثبت دریافت کامل و تأیید رزرو" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "تایید و ایجاد رزرو" }));
  await screen.findByRole("dialog", { name: "سفارش دستی ثبت شد" });
  const payload = JSON.parse(mocks.api.mock.calls.find(([path]) => path === "/admin/reservations")![1].body);
  expect(payload.status).toBe("PendingApproval");
  expect(payload.receivedPayment).toBeUndefined();
});

it("retains the same receipt submission key on a failed request retry", async () => {
  const original = mocks.api.getMockImplementation()!;
  let attempts = 0;
  mocks.api.mockImplementation((path: string, ...args: unknown[]) => {
    if (path === "/admin/reservations" && attempts++ === 0) return Promise.reject(new Error("response interrupted"));
    return original(path, ...args);
  });
  await openStay(vi.fn(), 10, undefined, undefined, true); await selectRooms();
  fireEvent.click(screen.getByRole("button", { name: "بررسی نهایی" }));
  fireEvent.click(screen.getByRole("radio", { name: "ثبت دریافت کامل و تأیید رزرو" }));
  fireEvent.click(screen.getByRole("button", { name: "ثبت دریافت کامل و تأیید رزرو" }));
  await screen.findByText("response interrupted");
  fireEvent.click(screen.getByRole("button", { name: "ثبت دریافت کامل و تأیید رزرو" }));
  await screen.findByRole("dialog", { name: "سفارش دستی ثبت شد" });
  const calls = mocks.api.mock.calls.filter(([path]) => path === "/admin/reservations");
  expect(calls).toHaveLength(2);
  expect(calls[0][1].body).toBe(calls[1][1].body);
});

it("requires a new review after a stale price or currency response without recording another receipt", async () => {
  const original = mocks.api.getMockImplementation()!;
  let stale = false;
  mocks.api.mockImplementation(async (path: string, ...args: unknown[]) => {
    if (path === "/admin/reservations") {
      stale = true;
      throw new ApiRequestError("قیمت یا ارز سفارش تغییر کرده است؛ دوباره بررسی کنید.", 409, { code: "ManualBookingReviewChanged" });
    }
    const result = await original(path, ...args);
    return path === "/admin/reservations/price-preview" && stale
      ? { ...result, finalAmount: 660, roomPrices: result.roomPrices.map((room: object) => ({ ...room, finalAmount: 220 })) } : result;
  });
  await openStay(vi.fn(), 10, undefined, undefined, true); await selectRooms();
  fireEvent.click(screen.getByRole("button", { name: "بررسی نهایی" }));
  fireEvent.click(screen.getByRole("radio", { name: "ثبت دریافت کامل و تأیید رزرو" }));
  fireEvent.click(screen.getByRole("button", { name: "ثبت دریافت کامل و تأیید رزرو" }));
  expect(await screen.findByRole("heading", { name: "اتاق‌های قابل رزرو" })).toBeTruthy();
  await waitFor(() => expect((screen.getByRole("button", { name: "بررسی نهایی" }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole("button", { name: "بررسی نهایی" }));
  expect(screen.getByText("۶۶۰ ریال")).toBeTruthy();
  expect((screen.getByRole("radio", { name: "ثبت رزرو بدون دریافت وجه" }) as HTMLInputElement).checked).toBe(true);
  expect(mocks.api.mock.calls.filter(([path]) => path === "/admin/reservations")).toHaveLength(1);
});

it.each(["IRR", "USD"])("uses the stored currency in manual reservation amount details without converting it: %s", async currency => {
  render(<ReservationDetailsDialog open onOpenChange={vi.fn()} reservation={{
    id: 50, reservationNumber: "R-100000", propertyId: 10, propertyName: "اقامتگاه آزمون",
    source: "AdminCreated", currency, status: "Pending", checkInDate: "2035-02-01", checkOutDate: "2035-02-03",
    finalAmount: 5_000_000, remainingAmount: 5_000_000, allowedStatusTransitions: [],
  }} />);
  await screen.findByRole("dialog", { name: "جزئیات رزرو" });
  const finance = screen.getByRole("heading", { name: "مالی" }).closest("section")!;
  expect(within(finance).getByText("مبلغ نهایی").parentElement?.textContent)
    .toContain(`۵٬۰۰۰٬۰۰۰ ${currency === "IRR" ? "ریال" : currency}`);
  expect(within(finance).queryByText(/تومان/)).toBeNull();
});

it("creates all selected rooms and shows every reservation and the authoritative order total", async () => {
  const refresh = vi.fn();
  await openStay(refresh);
  fireEvent.submit(document.getElementById("manual-reservation-form")!);
  expect(mocks.api.mock.calls.filter(([path]) => path === "/admin/reservations")).toHaveLength(0);
  await selectRooms();
  fireEvent.submit(document.getElementById("manual-reservation-form")!);
  expect(mocks.api.mock.calls.filter(([path]) => path === "/admin/reservations")).toHaveLength(0);
  fireEvent.click(screen.getByRole("button", { name: "بررسی نهایی" }));
  expect(screen.getByRole("region", { name: "خلاصه سفارش دستی" })).toBeTruthy();
  expect(within(screen.getByRole("list", { name: "قیمت اتاق‌های انتخاب‌شده" })).getAllByRole("listitem")).toHaveLength(3);
  const finalSubmit = await screen.findByRole("button", { name: "تایید و ایجاد رزرو" });
  fireEvent.click(finalSubmit);
  fireEvent.click(finalSubmit);
  const result = await screen.findByRole("dialog", { name: "سفارش دستی ثبت شد" });
  expect(within(result).getByText("O-123456")).toBeTruthy();
  expect(within(result).getByText(/مبلغ کل سفارش/).parentElement?.textContent).toContain("۶۰۰");
  expect(within(result).getAllByRole("link").map(link => link.getAttribute("href"))).toEqual([
    "/admin/reservations?reservationId=50", "/admin/reservations?reservationId=51", "/admin/reservations?reservationId=52",
  ]);
  expect(refresh).toHaveBeenCalledOnce();
  const creates = mocks.api.mock.calls.filter(([path, options]) => path === "/admin/reservations" && options?.method === "POST");
  expect(creates).toHaveLength(1);
  expect(JSON.parse(creates[0][1].body).roomIds).toEqual([30, 32, 33]);
  expect(JSON.parse(creates[0][1].body).adults).toBe(3);
  expect(mocks.error).not.toHaveBeenCalled();
});

it("does not fetch before prerequisites and distinguishes genuinely empty availability", async () => {
  const original = mocks.api.getMockImplementation()!;
  mocks.api.mockImplementation((path: string, ...args: unknown[]) => path.startsWith("/admin/reservations/available-rooms")
    ? Promise.resolve({ options: [], excluded: [] }) : original(path, ...args));
  render(<ManualReservationDialog context="admin" fixedPropertyId={10} onCreated={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "افزودن رزرو" }));
  expect((await screen.findByRole("button", { name: "انتخاب اتاق‌ها" }) as HTMLButtonElement).disabled).toBe(true);
  expect(mocks.api.mock.calls.some(([path]) => path.includes("available-rooms"))).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "انتخاب تاریخ آزمون" }));
  fireEvent.click(screen.getByRole("button", { name: "انتخاب مهمان" }));
  fireEvent.change(await screen.findByPlaceholderText("نام، موبایل یا ایمیل"), { target: { value: "آزمون" } });
  fireEvent.click(await screen.findByRole("button", { name: /مهمان آزمون/ }));
  fireEvent.click(screen.getByRole("button", { name: "انتخاب اتاق‌ها" }));
  expect(await screen.findByText("برای این اقامتگاه در بازهٔ انتخاب‌شده اتاق قابل رزرو نیست.")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "بررسی نهایی" })).toBeNull();
  expect(screen.getByRole("button", { name: "انتخاب تاریخ آزمون" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "تلاش دوباره برای دریافت اتاق‌ها" })).toBeNull();
});

it("shows real loading and ignores a late response for the previous dates", async () => {
  const original = mocks.api.getMockImplementation()!;
  let finishOld!: (rooms: unknown[]) => void;
  let finishNew!: (rooms: unknown[]) => void;
  mocks.api.mockImplementation((path: string, ...args: unknown[]) => {
    if (path.includes("available-rooms") && path.includes("2035-02-01"))
      return new Promise(resolve => { finishOld = resolve; });
    if (path.includes("available-rooms")) return new Promise(resolve => { finishNew = resolve; });
    return original(path, ...args);
  });
  await openStay();
  fireEvent.click(screen.getByRole("button", { name: "انتخاب اتاق‌ها" }));
  expect(await screen.findByText("در حال دریافت اتاق‌های موجود…")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "بررسی نهایی" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "انتخاب تاریخ جدید" }));
  fireEvent.click(screen.getByRole("button", { name: "انتخاب اتاق‌ها" }));
  await act(async () => finishOld([{ id: 99, name: "اتاق پاسخ منقضی", capacity: 2, roomTypeId: 20, bookingMode: "Instant" }]));
  expect(screen.queryByRole("button", { name: "بررسی نهایی" })).toBeNull();
  expect(screen.getByText("در حال دریافت اتاق‌های موجود…")).toBeTruthy();
  await act(async () => finishNew(await original("/admin/reservations/available-rooms")));
  expect(await screen.findByRole("button", { name: /^اتاق/ })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: /^اتاق/ }));
  expect(await screen.findByRole("button", { name: /اتاق ۳۰/ })).toBeTruthy();
  expect(screen.queryByText("اتاق پاسخ منقضی")).toBeNull();
  const calls = mocks.api.mock.calls.filter(([path]) => path.includes("available-rooms"));
  expect(calls).toHaveLength(2);
  for (const [path] of calls) {
    const query = new URL(path, "http://isolated.test").searchParams;
    expect(query.get("propertyId")).toBe("10");
    expect(query.has("roomTypeId")).toBe(false);
    expect(query.has("excludeReservationId")).toBe(false);
  }
});

it("revalidates occupancy/pricing after guest details change without discarding rooms", async () => {
  await openStay(); await selectRooms();
  fireEvent.click(screen.getByRole("button", { name: "بازگشت" }));
  fireEvent.click(screen.getByRole("button", { name: "افزایش بزرگسالان" }));
  fireEvent.click(screen.getByRole("button", { name: "افزایش کودکان" }));
  expect((screen.getByRole("button", { name: "انتخاب اتاق‌ها" }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.change(screen.getByRole("combobox", { name: "سن کودک ۱" }), { target: { value: "8" } });
  fireEvent.click(screen.getByRole("button", { name: "انتخاب اتاق‌ها" }));
  await screen.findByRole("button", { name: "بررسی نهایی" });
  await waitFor(() => expect((screen.getByRole("button", { name: "بررسی نهایی" }) as HTMLButtonElement).disabled).toBe(false));
  const previews = mocks.api.mock.calls.filter(([path]) => path === "/admin/reservations/price-preview");
  expect(JSON.parse(previews.at(-1)![1].body)).toMatchObject({ adults: 4, children: 1, childAges: [8], roomCount: 3 });
  fireEvent.click(screen.getByRole("button", { name: "بررسی نهایی" }));
  expect(within(screen.getByRole("list", { name: "قیمت اتاق‌های انتخاب‌شده" })).getAllByRole("listitem")).toHaveLength(3);
});

it("uses the OnRequest status and never offers confirmed creation", async () => {
  const original = mocks.api.getMockImplementation()!;
  mocks.api.mockImplementation(async (path: string, ...args: unknown[]) => {
    const response = await original(path, ...args);
    return path.includes("available-rooms") ? { ...response, options: response.options.map((option: { rooms: object[] }) => ({
      ...option, bookingMode: "OnRequest", rooms: option.rooms.map(room => ({ ...room, bookingMode: "OnRequest" }))
    })) } : response;
  });
  await openStay(); await selectRooms();
  fireEvent.click(screen.getByRole("button", { name: "بررسی نهایی" }));
  expect(screen.getByRole("button", { name: "در انتظار تایید" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "تایید شده" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "تایید و ایجاد رزرو" }));
  await screen.findByRole("dialog", { name: "سفارش دستی ثبت شد" });
  const create = mocks.api.mock.calls.find(([path]) => path === "/admin/reservations");
  expect(JSON.parse(create![1].body).status).toBe("PendingApproval");
});

it("preserves guests and eligible selections on Back and fresh date checks", async () => {
  await openStay();
  await selectRooms();
  fireEvent.click(screen.getByRole("button", { name: "بررسی نهایی" }));
  fireEvent.click(screen.getByRole("button", { name: "بازگشت" }));
  expect((screen.getByRole("button", { name: "بررسی نهایی" }) as HTMLButtonElement).disabled).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "بازگشت" }));
  expect(screen.getByRole("status", { name: "بزرگسالان" }).textContent).toBe("۳");
  fireEvent.click(screen.getByRole("button", { name: "انتخاب تاریخ جدید" }));
  fireEvent.click(screen.getByRole("button", { name: "انتخاب اتاق‌ها" }));
  await waitFor(() => expect(mocks.api.mock.calls.some(([path]) => path.includes("checkInDate=2035-02-05") && path.includes("checkOutDate=2035-02-07"))).toBe(true));
  await waitFor(() => expect((screen.getByRole("button", { name: "بررسی نهایی" }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole("button", { name: "بررسی نهایی" }));
  expect(within(screen.getByRole("list", { name: "قیمت اتاق‌های انتخاب‌شده" })).getAllByRole("listitem")).toHaveLength(3);
  expect(mocks.api.mock.calls.filter(([path]) => path === "/admin/reservations")).toHaveLength(0);
});

it("keeps the selected rooms on unchanged Back/Forward while checking current availability again", async () => {
  await openStay(); await selectRooms();
  fireEvent.click(screen.getByRole("button", { name: "بازگشت" }));
  fireEvent.click(screen.getByRole("button", { name: "انتخاب اتاق‌ها" }));
  await waitFor(() => expect((screen.getByRole("button", { name: "بررسی نهایی" }) as HTMLButtonElement).disabled).toBe(false));
  expect(mocks.api.mock.calls.filter(([path]) => path.includes("available-rooms"))).toHaveLength(2);
  fireEvent.click(screen.getByRole("button", { name: "بررسی نهایی" }));
  expect(within(screen.getByRole("list", { name: "قیمت اتاق‌های انتخاب‌شده" })).getAllByRole("listitem")).toHaveLength(3);
  expect(mocks.api.mock.calls.filter(([path]) => path === "/admin/reservations")).toHaveLength(0);
});

it("preserves all input after final submission fails", async () => {
  const original = mocks.api.getMockImplementation()!;
  mocks.api.mockImplementation((path: string, ...args: unknown[]) => path === "/admin/reservations"
    ? Promise.reject(new Error("Synthetic save failure")) : original(path, ...args));
  await openStay(); await selectRooms();
  fireEvent.click(screen.getByRole("button", { name: "بررسی نهایی" }));
  fireEvent.click(screen.getByRole("button", { name: "تایید و ایجاد رزرو" }));
  expect(await screen.findByText("Synthetic save failure")).toBeTruthy();
  expect(screen.getByRole("region", { name: "خلاصه سفارش دستی" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "بازگشت" }));
  fireEvent.click(screen.getByRole("button", { name: "بازگشت" }));
  expect(screen.getByRole("status", { name: "بزرگسالان" }).textContent).toBe("۳");
});

it("shows each server-provided room amount instead of dividing the order total", async () => {
  const original = mocks.api.getMockImplementation()!;
  mocks.api.mockImplementation(async (path: string, ...args: unknown[]) => {
    const result = await original(path, ...args);
    return path === "/admin/reservations/price-preview" ? {
      ...result, finalAmount: 700,
      roomPrices: [200, 300, 200].map(finalAmount => ({ adults: 1, children: 0, finalAmount, currency: "IRR" })),
    } : result;
  });
  await openStay(); await selectRooms();
  fireEvent.click(screen.getByRole("button", { name: "بررسی نهایی" }));
  const rows = within(screen.getByRole("list", { name: "قیمت اتاق‌های انتخاب‌شده" })).getAllByRole("listitem");
  expect(rows.map(row => row.textContent)).toEqual([
    expect.stringContaining("۲۰۰"), expect.stringContaining("۳۰۰"), expect.stringContaining("۲۰۰"),
  ]);
  expect(screen.getByRole("region", { name: "خلاصه سفارش دستی" }).textContent).toContain("۷۰۰");
});

it("preserves guest identity, type, adults, children and ages on property/date changes but clears cross-property rooms", async () => {
  await openStay(vi.fn(), null); await selectRooms();
  fireEvent.click(screen.getByRole("button", { name: "بازگشت" }));
  fireEvent.change(screen.getByLabelText("نوع مهمان"), { target: { value: "Foreign" } });
  fireEvent.click(screen.getByRole("button", { name: "افزایش کودکان" }));
  fireEvent.click(screen.getByRole("button", { name: "افزایش کودکان" }));
  fireEvent.change(screen.getByRole("combobox", { name: "سن کودک ۱" }), { target: { value: "4" } });
  fireEvent.change(screen.getByRole("combobox", { name: "سن کودک ۲" }), { target: { value: "8" } });
  fireEvent.click(screen.getByRole("button", { name: /^اقامتگاه/ }));
  fireEvent.click(await screen.findByRole("button", { name: "اقامتگاه دوم" }));
  fireEvent.click(screen.getByRole("button", { name: "انتخاب تاریخ جدید" }));
  expect(screen.getByRole("status", { name: "بزرگسالان" }).textContent).toBe("۳");
  expect((screen.getByLabelText("نوع مهمان") as HTMLSelectElement).value).toBe("Foreign");
  expect(screen.getByRole("status", { name: "کودکان" }).textContent).toBe("۲");
  expect((screen.getByRole("combobox", { name: "سن کودک ۱" }) as HTMLInputElement).value).toBe("4");
  expect((screen.getByRole("combobox", { name: "سن کودک ۲" }) as HTMLInputElement).value).toBe("8");
  expect(screen.getByRole("button", { name: /مهمان آزمون/ })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "انتخاب اتاق‌ها" }));
  expect(await screen.findByRole("button", { name: "بررسی نهایی" })).toBeTruthy();
  expect((screen.getByRole("button", { name: "بررسی نهایی" }) as HTMLButtonElement).disabled).toBe(true);
  expect(mocks.api.mock.calls.filter(([path]) => path.includes("available-rooms")).at(-1)![0]).toContain("propertyId=11");
  expect(screen.queryByText("اتاق ۳۰")).toBeNull();
  expect(mocks.api.mock.calls.filter(([path]) => path === "/admin/reservations")).toHaveLength(0);
});

it("retains only still-available selected rooms after a date change and re-prices that selection", async () => {
  await openStay(); await selectRooms();
  const original = mocks.api.getMockImplementation()!;
  mocks.api.mockImplementation(async (path: string, ...args: unknown[]) => {
    const result = await original(path, ...args);
    if (path.includes("available-rooms")) return { ...result, options: result.options.map((option: { rooms: { id: number }[] }) => ({
      ...option, rooms: option.rooms.filter(room => room.id !== 32)
    })) };
    if (path === "/admin/reservations/price-preview") return {
      ...result, roomCount: 2, finalAmount: 400, roomPrices: result.roomPrices.slice(0, 2),
    };
    return result;
  });
  fireEvent.click(screen.getByRole("button", { name: "بازگشت" }));
  fireEvent.click(screen.getByRole("button", { name: "انتخاب تاریخ جدید" }));
  fireEvent.click(screen.getByRole("button", { name: "انتخاب اتاق‌ها" }));
  await waitFor(() => expect((screen.getByRole("button", { name: "بررسی نهایی" }) as HTMLButtonElement).disabled).toBe(false));
  const preview = mocks.api.mock.calls.filter(([path]) => path === "/admin/reservations/price-preview").at(-1)!;
  expect(JSON.parse(preview[1].body)).toMatchObject({ roomCount: 2, checkInDate: "2035-02-05", adults: 3 });
  fireEvent.click(screen.getByRole("button", { name: "بررسی نهایی" }));
  const list = screen.getByRole("list", { name: "قیمت اتاق‌های انتخاب‌شده" });
  expect(within(list).getAllByRole("listitem")).toHaveLength(2);
  expect(list.textContent).toContain("اتاق 30");
  expect(list.textContent).toContain("اتاق 33");
  expect(list.textContent).not.toContain("اتاق 32");
});

it("ignores a failed request after switching properties and does not advance until the new check succeeds", async () => {
  const original = mocks.api.getMockImplementation()!;
  let failOld!: (error: Error) => void;
  mocks.api.mockImplementation((path: string, ...args: unknown[]) => path.includes("available-rooms") && path.includes("propertyId=10")
    ? new Promise((_resolve, reject) => { failOld = reject; }) : original(path, ...args));
  await openStay(vi.fn(), null);
  fireEvent.click(screen.getByRole("button", { name: "انتخاب اتاق‌ها" }));
  await screen.findByText("در حال دریافت اتاق‌های موجود…");
  fireEvent.click(screen.getByRole("button", { name: /^اقامتگاه/ }));
  fireEvent.click(await screen.findByRole("button", { name: "اقامتگاه دوم" }));
  await act(async () => failOld(new Error("Old property failure")));
  expect(screen.queryByText("Old property failure")).toBeNull();
  expect(screen.queryByRole("button", { name: "بررسی نهایی" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "انتخاب اتاق‌ها" }));
  expect(await screen.findByRole("button", { name: "بررسی نهایی" })).toBeTruthy();
});

it("does not advance a closed/reopened wizard from a previous availability response", async () => {
  const original = mocks.api.getMockImplementation()!;
  let finish!: (rooms: unknown[]) => void;
  mocks.api.mockImplementation((path: string, ...args: unknown[]) => path.includes("available-rooms")
    ? new Promise(resolve => { finish = resolve; }) : original(path, ...args));
  await openStay();
  fireEvent.click(screen.getByRole("button", { name: "انتخاب اتاق‌ها" }));
  await screen.findByText("در حال دریافت اتاق‌های موجود…");
  fireEvent.click(screen.getByRole("button", { name: "انصراف" }));
  fireEvent.click(screen.getByRole("button", { name: "افزودن رزرو" }));
  await act(async () => finish(await original("/admin/reservations/available-rooms")));
  const next = await screen.findByRole("button", { name: "انتخاب اتاق‌ها" });
  expect(screen.queryByRole("button", { name: "بررسی نهایی" })).toBeNull();
  expect((next as HTMLButtonElement).disabled).toBe(true);
});

it("books TypeBased quantities without physical room IDs and keeps mixed missing-price feedback visible", async () => {
  const original = mocks.api.getMockImplementation()!;
  mocks.api.mockImplementation((path: string, ...args: unknown[]) => path.includes("available-rooms")
    ? Promise.resolve({ options: [{ roomTypeId: 20, name: "سوئیت تعدادی", inventoryMode: "TypeBasedInventory",
      availableCount: 3, bookingMode: "Instant", rooms: [] }], excluded: [{ roomTypeId: 21, name: "بدون نرخ",
      reason: "MissingNightlyPricing", missingDates: ["2035-02-02"] }] }) : original(path, ...args));
  await openStay();
  fireEvent.click(screen.getByRole("button", { name: "انتخاب اتاق‌ها" }));
  const type = await screen.findByLabelText("نوع اتاق (موجودی تعدادی)");
  expect(screen.getByText(/قیمت معتبر برای شب‌های/).textContent).toContain("۲۰۳۵-۰۲-۰۲");
  expect(screen.queryByRole("button", { name: /^اتاق/ })).toBeNull();
  fireEvent.change(type, { target: { value: "20" } });
  fireEvent.change(screen.getByRole("spinbutton", { name: /تعداد واحد/ }), { target: { value: "4" } });
  expect((screen.getByRole("button", { name: "بررسی نهایی" }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.change(screen.getByRole("spinbutton", { name: /تعداد واحد/ }), { target: { value: "3" } });
  await waitFor(() => expect((screen.getByRole("button", { name: "بررسی نهایی" }) as HTMLButtonElement).disabled).toBe(false));
  const preview = mocks.api.mock.calls.filter(([path]) => path === "/admin/reservations/price-preview").at(-1)!;
  expect(JSON.parse(preview[1].body)).toMatchObject({ forManualCreation: true, roomTypeId: 20, roomCount: 3 });
  fireEvent.click(screen.getByRole("button", { name: "بررسی نهایی" }));
  expect(within(screen.getByRole("list", { name: "قیمت اتاق‌های انتخاب‌شده" })).getAllByRole("listitem")).toHaveLength(3);
  fireEvent.click(screen.getByRole("button", { name: "تایید و ایجاد رزرو" }));
  await screen.findByRole("dialog", { name: "سفارش دستی ثبت شد" });
  const create = mocks.api.mock.calls.find(([path]) => path === "/admin/reservations")!;
  expect(JSON.parse(create[1].body)).toMatchObject({ roomId: 0, roomIds: [], roomCount: 3,
    roomTypeSelections: [{ roomTypeId: 20, quantity: 3 }], adults: 3 });
});

it("stays on Step 1 with server reasons and missing dates when every option is blocked", async () => {
  const original = mocks.api.getMockImplementation()!;
  mocks.api.mockImplementation((path: string, ...args: unknown[]) => path.includes("available-rooms")
    ? Promise.resolve({ options: [], excluded: [
      { roomTypeId: 20, name: "بدون قیمت", reason: "MissingNightlyPricing", missingDates: ["2035-02-01"] },
      { roomTypeId: 21, name: "پر", reason: "NoAvailability", missingDates: [] },
      { roomTypeId: 22, name: "نام‌دار", reason: "NoEligibleNamedRooms", missingDates: [] }
    ] }) : original(path, ...args));
  await openStay();
  fireEvent.click(screen.getByRole("button", { name: "انتخاب اتاق‌ها" }));
  expect(await screen.findByText(/قیمت معتبر برای شب‌های/)).toBeTruthy();
  expect(screen.getByText(/اتاق نام‌دار فعال و آزاد/)).toBeTruthy();
  expect(screen.getByText(/موجودی قابل فروش ندارد/)).toBeTruthy();
  expect(screen.queryByRole("button", { name: "بررسی نهایی" })).toBeNull();
  expect(screen.getByRole("button", { name: "انتخاب تاریخ جدید" })).toBeTruthy();
});

it("preserves a TypeBased quantity on unchanged navigation and revalidates it when dates change", async () => {
  const original = mocks.api.getMockImplementation()!;
  mocks.api.mockImplementation(async (path: string, ...args: unknown[]) => {
    if (path.includes("available-rooms")) return { options: [{ roomTypeId: 20, name: "سوئیت تعدادی",
      inventoryMode: "TypeBasedInventory", availableCount: path.includes("2035-02-05") ? 2 : 3,
      bookingMode: "Instant", rooms: [] }], excluded: [] };
    const result = await original(path, ...args);
    if (path === "/admin/reservations/price-preview") {
      const count = JSON.parse((args[0] as { body: string }).body).roomCount as number;
      return { ...result, roomCount: count, finalAmount: count * 200, roomPrices: result.roomPrices.slice(0, count) };
    }
    return result;
  });
  await openStay();
  fireEvent.click(screen.getByRole("button", { name: "انتخاب اتاق‌ها" }));
  fireEvent.change(await screen.findByLabelText("نوع اتاق (موجودی تعدادی)"), { target: { value: "20" } });
  fireEvent.change(screen.getByRole("spinbutton", { name: /تعداد واحد/ }), { target: { value: "3" } });
  await waitFor(() => expect((screen.getByRole("button", { name: "بررسی نهایی" }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole("button", { name: "بازگشت" }));
  fireEvent.click(screen.getByRole("button", { name: "انتخاب اتاق‌ها" }));
  expect((await screen.findByRole("spinbutton", { name: /تعداد واحد/ }) as HTMLInputElement).value).toBe("3");
  fireEvent.click(screen.getByRole("button", { name: "بازگشت" }));
  fireEvent.click(screen.getByRole("button", { name: "انتخاب تاریخ جدید" }));
  expect(screen.getByRole("status", { name: "بزرگسالان" }).textContent).toBe("۳");
  fireEvent.click(screen.getByRole("button", { name: "انتخاب اتاق‌ها" }));
  expect((await screen.findByRole("spinbutton", { name: /تعداد واحد/ }) as HTMLInputElement).value).toBe("2");
  await waitFor(() => expect((screen.getByRole("button", { name: "بررسی نهایی" }) as HTMLButtonElement).disabled).toBe(false));
  const preview = mocks.api.mock.calls.filter(([path]) => path === "/admin/reservations/price-preview").at(-1)!;
  expect(JSON.parse(preview[1].body)).toMatchObject({ checkInDate: "2035-02-05", roomCount: 2, adults: 3 });
});

it("keeps Step 2 compact before selection, with no second date request or large empty panels", async () => {
  await openStay();
  fireEvent.click(screen.getByRole("button", { name: "انتخاب اتاق‌ها" }));
  await screen.findByRole("button", { name: "بررسی نهایی" });
  expect(screen.getByText(/نوع و تعداد واحد یا اتاق‌های نام‌دار را انتخاب کنید/)).toBeTruthy();
  expect(screen.queryByText("برای نمایش قوانین رزرو، ابتدا اتاق را انتخاب کنید.")).toBeNull();
  expect(screen.queryByRole("heading", { name: "خلاصه قیمت" })).toBeNull();
  expect(screen.queryByRole("button", { name: "انتخاب تاریخ آزمون" })).toBeNull();
  const rooms = screen.getByRole("button", { name: /^اتاق/ });
  fireEvent.click(rooms);
  fireEvent.click(await screen.findByRole("button", { name: /انتخاب همه/ }));
  fireEvent.click(rooms);
  expect(await screen.findByRole("heading", { name: "خلاصه قیمت" })).toBeTruthy();
});

it("finishes in the same dialog and offers only the server-authorized per-reservation approval review", async () => {
  const original = mocks.api.getMockImplementation()!;
  mocks.api.mockImplementation(async (path: string, ...args: unknown[]) => {
    const result = await original(path, ...args);
    if (path === "/admin/reservations") return { ...result, reservations: result.reservations.map((item: object, index: number) => ({
      ...item, status: index === 0 ? "Pending" : "PendingApproval",
      allowedStatusTransitions: index === 1 ? [] : ["ApprovedAwaitingPayment"],
    })) };
    return result;
  });
  const reviewAction = vi.fn();
  await openStay(vi.fn(), 10, reviewAction); await selectRooms();
  const originalDialog = screen.getByRole("dialog", { name: "افزودن رزرو" });
  fireEvent.click(screen.getByRole("button", { name: "بررسی نهایی" }));
  fireEvent.click(screen.getByRole("button", { name: "تایید و ایجاد رزرو" }));
  const result = await screen.findByRole("dialog", { name: "سفارش دستی ثبت شد" });
  expect(result).toBe(originalDialog);
  expect(screen.getAllByRole("dialog")).toHaveLength(1);
  expect(document.getElementById("manual-reservation-form")).toBeNull();
  expect(within(result).queryByRole("button", { name: "تایید و ایجاد رزرو" })).toBeNull();
  expect(within(result).getByText("تعداد رزروها").parentElement?.textContent).toContain("۳");
  expect(within(result).getAllByRole("button", { name: /بررسی و تأیید رزرو/ })).toHaveLength(1);
  expect(within(result).queryByRole("button", { name: /پرداخت/ })).toBeNull();
  expect(within(result).getByText(/این اقدام مربوط به کل سفارش نیست/)).toBeTruthy();
  expect(reviewAction).not.toHaveBeenCalled();
  fireEvent.click(within(result).getByRole("button", { name: "بررسی و تأیید رزرو R-100002" }));
  expect(reviewAction).toHaveBeenCalledExactlyOnceWith(52);
  expect(mocks.api.mock.calls.some(([path]) => path.endsWith("/approve"))).toBe(false);
  expect(mocks.api.mock.calls.filter(([path]) => path === "/admin/reservations")).toHaveLength(1);
});

it("preserves success after a list-refresh failure, without resubmit or fallback actions for Pending", async () => {
  const original = mocks.api.getMockImplementation()!;
  mocks.api.mockImplementation(async (path: string, ...args: unknown[]) => {
    const result = await original(path, ...args);
    return path === "/admin/reservations" ? { ...result, reservations: result.reservations.map((item: object) => ({
      ...item, status: "Pending", allowedStatusTransitions: ["Confirmed", "Cancelled"],
    })) } : result;
  });
  await openStay(vi.fn().mockRejectedValue(new Error("refresh failed")), 10, vi.fn()); await selectRooms();
  fireEvent.click(screen.getByRole("button", { name: "بررسی نهایی" }));
  fireEvent.click(screen.getByRole("button", { name: "تایید و ایجاد رزرو" }));
  const result = await screen.findByRole("dialog", { name: "سفارش دستی ثبت شد" });
  await waitFor(() => expect(mocks.warning).toHaveBeenCalledOnce());
  expect(within(result).queryByRole("button", { name: /بررسی و تأیید|پرداخت/ })).toBeNull();
  expect(within(result).queryByText("refresh failed")).toBeNull();
  expect(within(result).getAllByRole("link")).toHaveLength(3);
  expect(document.getElementById("manual-reservation-form")).toBeNull();
  expect(mocks.error).not.toHaveBeenCalled();
  expect(mocks.api.mock.calls.filter(([path]) => path === "/admin/reservations")).toHaveLength(1);
  fireEvent.click(within(result).getByText("بستن"));
  fireEvent.click(screen.getByRole("button", { name: "افزودن رزرو" }));
  const next = await screen.findByRole("button", { name: "انتخاب اتاق‌ها" });
  expect((next as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByRole("status", { name: "بزرگسالان" }).textContent).toBe("۱");
});

it("does not offer approval review without property permission even when the status transition is valid", async () => {
  const original = mocks.api.getMockImplementation()!;
  mocks.api.mockImplementation(async (path: string, ...args: unknown[]) => {
    const result = await original(path, ...args);
    return path === "/admin/reservations" ? { ...result, reservations: result.reservations.map((item: object) => ({
      ...item, status: "PendingApproval", allowedStatusTransitions: ["ApprovedAwaitingPayment"],
    })) } : result;
  });
  const canReview = vi.fn(() => false);
  const reviewAction = vi.fn();
  await openStay(vi.fn(), 10, reviewAction, canReview); await selectRooms();
  fireEvent.click(screen.getByRole("button", { name: "بررسی نهایی" }));
  fireEvent.click(screen.getByRole("button", { name: "تایید و ایجاد رزرو" }));
  const result = await screen.findByRole("dialog", { name: "سفارش دستی ثبت شد" });
  expect(canReview).toHaveBeenCalledWith(10);
  expect(within(result).queryByRole("button", { name: /بررسی و تأیید/ })).toBeNull();
  expect(within(result).getAllByRole("link")).toHaveLength(3);
  expect(reviewAction).not.toHaveBeenCalled();
});
