import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { ManualReservationDialog } from "@/components/reservations/ManualReservationDialog";

const mocks = vi.hoisted(() => ({ api: vi.fn(), error: vi.fn(), success: vi.fn() }));
vi.mock("@/lib/owner-api", async importOriginal => ({
  ...await importOriginal<typeof import("@/lib/owner-api")>(), apiRequest: mocks.api,
}));
vi.mock("sonner", () => ({ toast: { error: mocks.error, success: mocks.success } }));
vi.mock("@/components/KoochDatePicker", () => ({ KoochDatePicker: ({ onChange }: {
  onChange: (value: { startDate: string; endDate: string }) => void;
}) => <><button type="button" onClick={() => onChange({ startDate: "2035-02-01", endDate: "2035-02-03" })}>انتخاب تاریخ آزمون</button>
  <button type="button" onClick={() => onChange({ startDate: "2035-02-05", endDate: "2035-02-07" })}>انتخاب تاریخ جدید</button></> }));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.api.mockImplementation(async (path: string) => {
    if (path === "/admin/properties") return [{ id: 10, name: "اقامتگاه آزمون" }, { id: 11, name: "اقامتگاه دوم" }];
    if (path.startsWith("/admin/guests")) return [{ id: 40, firstName: "مهمان", lastName: "آزمون", mobile: "09123456789" }];
    if (path.startsWith("/admin/reservations/available-rooms")) return [30, 32, 33].map(roomId => ({
      id: roomId, roomTypeId: 20, name: `اتاق ${roomId}`, capacity: 2,
      bookingMode: "Instant", allowExtraGuest: false, maxExtraGuests: 0,
    }));
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
        reservationNumber: `R-${100000 + index}`, roomName: `اتاق ${roomId}`, roomTypeName: "دبل", finalAmount: 200 })),
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

async function openStay(onCreated = vi.fn(), fixedPropertyId: number | null = 10) {
  render(<ManualReservationDialog context="admin" fixedPropertyId={fixedPropertyId ?? undefined} onCreated={onCreated} />);
  fireEvent.click(screen.getByRole("button", { name: "افزودن رزرو" }));
  if (fixedPropertyId === null) {
    fireEvent.click(await screen.findByRole("button", { name: /^اقامتگاه/ }));
    fireEvent.click(await screen.findByRole("button", { name: "اقامتگاه آزمون" }));
  }
  fireEvent.click(await screen.findByRole("button", { name: "انتخاب تاریخ آزمون" }));
  fireEvent.click(screen.getByRole("button", { name: "انتخاب مهمان" }));
  fireEvent.change(await screen.findByPlaceholderText("نام، موبایل یا ایمیل"), { target: { value: "آزمون" } });
  fireEvent.click(await screen.findByRole("button", { name: /مهمان آزمون/ }));
  fireEvent.change(screen.getByLabelText("بزرگسالان"), { target: { value: "3" } });
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
  expect(within(result).getByText(/مبلغ کل سفارش/).textContent).toContain("۶۰۰");
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
    ? Promise.resolve([]) : original(path, ...args));
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
  fireEvent.change(screen.getByLabelText("بزرگسالان"), { target: { value: "4" } });
  fireEvent.change(screen.getByRole("spinbutton", { name: "تعداد کودکان" }), { target: { value: "1" } });
  expect((screen.getByRole("button", { name: "انتخاب اتاق‌ها" }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.change(screen.getByRole("spinbutton", { name: /سن کودک 1/ }), { target: { value: "8" } });
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
    return path.includes("available-rooms") ? response.map((room: object) => ({ ...room, bookingMode: "OnRequest" })) : response;
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
  expect((screen.getByLabelText("بزرگسالان") as HTMLInputElement).value).toBe("3");
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
  expect((screen.getByLabelText("بزرگسالان") as HTMLInputElement).value).toBe("3");
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
  fireEvent.change(screen.getByRole("spinbutton", { name: "تعداد کودکان" }), { target: { value: "2" } });
  fireEvent.change(screen.getByRole("spinbutton", { name: /سن کودک 1/ }), { target: { value: "4" } });
  fireEvent.change(screen.getByRole("spinbutton", { name: /سن کودک 2/ }), { target: { value: "8" } });
  fireEvent.click(screen.getByRole("button", { name: /^اقامتگاه/ }));
  fireEvent.click(await screen.findByRole("button", { name: "اقامتگاه دوم" }));
  fireEvent.click(screen.getByRole("button", { name: "انتخاب تاریخ جدید" }));
  expect((screen.getByLabelText("بزرگسالان") as HTMLInputElement).value).toBe("3");
  expect((screen.getByLabelText("نوع مهمان") as HTMLSelectElement).value).toBe("Foreign");
  expect((screen.getByRole("spinbutton", { name: "تعداد کودکان" }) as HTMLInputElement).value).toBe("2");
  expect((screen.getByRole("spinbutton", { name: /سن کودک 1/ }) as HTMLInputElement).value).toBe("4");
  expect((screen.getByRole("spinbutton", { name: /سن کودک 2/ }) as HTMLInputElement).value).toBe("8");
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
    if (path.includes("available-rooms")) return result.filter((room: { id: number }) => room.id !== 32);
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
