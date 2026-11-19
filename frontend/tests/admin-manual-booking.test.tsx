import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { ManualReservationDialog } from "@/components/reservations/ManualReservationDialog";
import { ManualOrderSettlement } from "@/components/reservations/ManualOrderSettlement";
import { ReservationDetailsDialog } from "@/components/reservations/ReservationDetailsDialog";
import { ApiRequestError } from "@/lib/owner-api";
import { installNativePopoverStub } from "./helpers/native-popover";

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
  installNativePopoverStub();
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

it("keeps required child ages inside the floating picker and guest type separate", async () => {
  render(<ManualReservationDialog context="admin" fixedPropertyId={10} onCreated={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "افزودن رزرو" }));
  const wizard = await screen.findByRole("dialog", { name: "افزودن رزرو" });
  expect(wizard.className).toContain("max-w-3xl");
  const trigger = screen.getByRole("button", { name: /^مهمانان و اتاق‌ها:/ });
  expect(trigger.getAttribute("aria-expanded")).toBe("false");
  expect(screen.queryByRole("button", { name: "افزایش بزرگسال" })).toBeNull();
  expect(screen.queryByLabelText("تعداد واحد")).toBeNull();
  expect(screen.queryByRole("button", { name: "افزایش تعداد اتاق" })).toBeNull();
  fireEvent.click(trigger);
  const panel = screen.getByRole("group", { name: "انتخاب مسافران و اتاق‌ها" });
  expect(panel.id).toBe(trigger.getAttribute("aria-controls"));
  fireEvent.click(within(panel).getByRole("button", { name: "افزایش بزرگسال" }));
  fireEvent.click(within(panel).getByRole("button", { name: "افزایش کودک" }));
  const age = screen.getByRole("combobox", { name: "سن کودک ۱" }) as HTMLSelectElement;
  expect(age.value).toBe(""); expect(age.required).toBe(true);
  expect(panel.contains(age)).toBe(true);
  expect(trigger.getAttribute("aria-expanded")).toBe("true");
  fireEvent.change(age, { target: { value: "0" } });
  expect(panel.contains(screen.getByLabelText("نوع مهمان"))).toBe(false);
  age.focus();
  fireEvent.keyDown(age, { key: "Escape" });
  expect(screen.queryByRole("group", { name: "انتخاب مسافران و اتاق‌ها" })).toBeNull();
  expect(screen.queryByRole("combobox", { name: "سن کودک ۱" })).toBeNull();
  expect(document.activeElement).toBe(trigger);
  expect(screen.getByRole("dialog", { name: "افزودن رزرو" })).toBe(wizard);
  expect(trigger.textContent).toContain("۲ بزرگسال، ۱ کودک");
  fireEvent.click(trigger);
  expect((screen.getByRole("combobox", { name: "سن کودک ۱" }) as HTMLSelectElement).value).toBe("0");
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

function openGuestCounts() {
  const trigger = screen.getByRole("button", { name: /^مهمانان و اتاق‌ها:/ });
  if (trigger.getAttribute("aria-expanded") === "false") fireEvent.click(trigger);
}

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
  fireEvent.click(screen.getByRole("button", { name: /^مهمانان و اتاق‌ها:/ }));
  fireEvent.click(screen.getByRole("button", { name: "افزایش تعداد اتاق" }));
  fireEvent.click(screen.getByRole("button", { name: "افزایش تعداد اتاق" }));
  openGuestCounts();
  fireEvent.click(screen.getByRole("button", { name: "افزایش بزرگسال" }));
  openGuestCounts();
  fireEvent.click(screen.getByRole("button", { name: "افزایش بزرگسال" }));
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

async function selectType(name: string) {
  const picker = await screen.findByRole("button", { name: "نوع اتاق" });
  if (picker.getAttribute("aria-expanded") !== "true") fireEvent.click(picker);
  fireEvent.click(await screen.findByRole("button", { name: new RegExp(`^${name}`) }));
}

it("shows one prerequisite hint without field errors and clears it when step one is complete", async () => {
  render(<ManualReservationDialog context="admin" onCreated={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "افزودن رزرو" }));
  const next = await screen.findByRole("button", { name: "انتخاب اتاق‌ها" }) as HTMLButtonElement;
  const hint = () => document.getElementById(next.getAttribute("aria-describedby") ?? "");
  expect(next.disabled).toBe(true);
  expect(hint()?.textContent).toBe("اقامتگاه را انتخاب کنید.");
  expect(document.querySelector("[aria-invalid=true]")).toBeNull();
  const property = await screen.findByRole("button", { name: /^اقامتگاه/ });
  expect(property.closest("[class*='md:col-span-2']")).not.toBeNull();
  fireEvent.click(property);
  fireEvent.click(await screen.findByRole("button", { name: "اقامتگاه آزمون" }));
  expect(hint()?.textContent).toBe("مهمان را انتخاب کنید.");
  const guest = screen.getByRole("button", { name: "انتخاب مهمان" });
  expect(guest.closest("[class*=guestRow]")?.contains(screen.getByRole("button", { name: "افزودن مهمان" }))).toBe(true);
  fireEvent.click(guest);
  fireEvent.change(await screen.findByPlaceholderText("نام، موبایل یا ایمیل"), { target: { value: "آزمون" } });
  fireEvent.click(await screen.findByRole("button", { name: /مهمان آزمون/ }));
  expect(hint()?.textContent).toBe("تاریخ ورود و خروج را انتخاب کنید.");
  fireEvent.click(screen.getByRole("button", { name: "انتخاب تاریخ آزمون" }));
  expect(next.disabled).toBe(false);
  expect(next.getAttribute("aria-describedby")).toBeNull();
  expect(document.getElementById("manual-stay-hint")).toBeNull();
  expect((screen.getByLabelText("نوع مهمان") as HTMLSelectElement).className).toContain("h-[52px]");
  expect(screen.queryByText(/سن واقعی هر کودک لازم است/)).toBeNull();
  expect(mocks.api.mock.calls.some(([path]) => path.includes("available-rooms"))).toBe(false);
});

it("keeps child-age validation active when the floating picker closes", async () => {
  await openStay();
  openGuestCounts();
  fireEvent.click(screen.getByRole("button", { name: "افزایش کودک" }));
  expect(screen.getByText(/سن واقعی هر کودک لازم است/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: /^مهمانان و اتاق‌ها:/ }));
  const next = screen.getByRole("button", { name: "انتخاب اتاق‌ها" }) as HTMLButtonElement;
  expect(next.disabled).toBe(true);
  expect(document.getElementById(next.getAttribute("aria-describedby")!)?.textContent)
    .toBe("سن هر کودک را در انتخابگر مهمانان وارد کنید.");
  expect(screen.queryByRole("button", { name: "افزایش کودک" })).toBeNull();
  expect(screen.queryByRole("combobox", { name: "سن کودک ۱" })).toBeNull();
  openGuestCounts();
  fireEvent.change(screen.getByRole("combobox", { name: "سن کودک ۱" }), { target: { value: "0" } });
  expect(next.disabled).toBe(false);
  expect(document.getElementById("manual-stay-hint")).toBeNull();
  expect(mocks.api.mock.calls.some(([path]) => path === "/admin/reservations")).toBe(false);
});

it("allocates the requested total across named and TypeBased rooms with one authoritative mixed preview", async () => {
  const original = mocks.api.getMockImplementation()!;
  mocks.api.mockImplementation(async (path: string, ...args: unknown[]) => {
    const result = await original(path, ...args);
    if (path.includes("available-rooms")) return { options: [{ ...result.options[0], rooms: result.options[0].rooms.slice(0, 1) },
      { roomTypeId: 21, name: "سوئیت", inventoryMode: "TypeBasedInventory", availableCount: 2, bookingMode: "OnRequest", rooms: [] }], excluded: [] };
    if (path.includes("effective-rules")) return { ...result, roomTypeId: Number(new URL(path, "http://test").searchParams.get("roomTypeId")) };
    if (path === "/admin/reservations/price-preview") return { ...result, finalAmount: 1000,
      roomPrices: [200, 400, 400].map(finalAmount => ({ adults: 1, children: 0, finalAmount, currency: "IRR" })) };
    return result;
  });
  await openStay(vi.fn(), 10, undefined, undefined, true);
  fireEvent.click(screen.getByRole("button", { name: "انتخاب اتاق‌ها" }));
  const named = await screen.findByRole("button", { name: /^اتاق/ });
  fireEvent.click(named);
  fireEvent.click(await screen.findByRole("button", { name: /انتخاب همه/ }));
  fireEvent.click(named);
  expect((screen.getByRole("button", { name: "بررسی نهایی" }) as HTMLButtonElement).disabled).toBe(true);
  await selectType("سوئیت");
  fireEvent.click(screen.getByRole("button", { name: "افزایش تعداد سوئیت" }));
  await waitFor(() => expect((screen.getByRole("button", { name: "بررسی نهایی" }) as HTMLButtonElement).disabled).toBe(false));
  const preview = mocks.api.mock.calls.filter(([path]) => path === "/admin/reservations/price-preview").at(-1)!;
  expect(JSON.parse(preview[1].body)).toMatchObject({ roomCount: 3, roomIds: [30], roomTypeSelections: [{ roomTypeId: 21, quantity: 2 }] });
  fireEvent.click(screen.getByRole("button", { name: "بررسی نهایی" }));
  expect(within(screen.getByRole("list", { name: "قیمت اتاق‌های انتخاب‌شده" })).getAllByRole("listitem")).toHaveLength(3);
  expect(screen.queryByLabelText("ثبت دریافت کامل و تأیید رزرو")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "ثبت رزرو بدون دریافت وجه" }));
  await screen.findByRole("dialog", { name: "سفارش دستی ثبت شد" });
  const payload = JSON.parse(mocks.api.mock.calls.find(([path]) => path === "/admin/reservations")![1].body);
  expect(payload).toMatchObject({ roomCount: 3, roomIds: [30], roomTypeSelections: [{ roomTypeId: 21, quantity: 2 }] });
  expect(payload.status).toBeUndefined(); // Existing server derives each room's manual initial status.
  expect(payload.receivedPayment).toBeUndefined();
});

it("changing the requested room total clears stale allocations and requires a matching new selection", async () => {
  await openStay(); await selectRooms();
  fireEvent.click(screen.getByRole("button", { name: "بازگشت" }));
  openGuestCounts();
  fireEvent.click(screen.getByRole("button", { name: "کاهش تعداد اتاق" }));
  expect(screen.getByRole("button", { name: /^مهمانان و اتاق‌ها:/ }).textContent).toContain("۲ اتاق");
  fireEvent.click(screen.getByRole("button", { name: "انتخاب اتاق‌ها" }));
  await screen.findByText(/۰ از ۲ اتاق انتخاب شده/);
  expect(screen.queryByRole("heading", { name: "خلاصه قیمت" })).toBeNull();
  expect((screen.getByRole("button", { name: "بررسی نهایی" }) as HTMLButtonElement).disabled).toBe(true);
});

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
  fireEvent.click(screen.getByRole("button", { name: "ثبت رزرو بدون دریافت وجه" }));
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

it("reviews localized dates with click-only mode information instead of a read-only status card", async () => {
  await openStay(vi.fn(), 10, undefined, undefined, true); await selectRooms();
  fireEvent.click(screen.getByRole("button", { name: "بررسی نهایی" }));
  const review = screen.getByRole("region", { name: "خلاصه سفارش دستی" });
  for (const [label, iso, localized] of [["ورود", "2035-02-01", "۱۲ بهمن ۱۴۱۳"], ["خروج", "2035-02-03", "۱۴ بهمن ۱۴۱۳"]]) {
    const date = within(review).getByText(label).parentElement!.querySelector("time")!;
    expect(date.getAttribute("dateTime")).toBe(iso);
    expect(date.textContent).toBe(localized);
  }
  expect(screen.queryByText("وضعیت پس از ثبت")).toBeNull();
  expect(screen.queryByText("در انتظار")).toBeNull();
  expect(screen.queryByRole("button", { name: "در انتظار" })).toBeNull();
  expect(screen.queryByRole("group", { name: "انتخاب وضعیت رزرو" })).toBeNull();
  expect(screen.queryByText(/آماده‌سازی برای پرداخت، اقدام جداگانه‌ای است/)).toBeNull();
  const info = screen.getByRole("button", { name: "توضیح نحوه ثبت رزرو" });
  fireEvent.focus(info);
  expect(info.getAttribute("aria-expanded")).toBe("false");
  fireEvent.click(info);
  expect(screen.getByText(/آماده‌سازی برای پرداخت، اقدام جداگانه‌ای است/)).toBeTruthy();
  expect(screen.getByRole("button", { name: "ثبت رزرو بدون دریافت وجه" })).toBeTruthy();
  expect(within(review).getByText("مبلغ کل سفارش").parentElement!.textContent).toContain("۶۰۰ ریال");
  fireEvent.change(screen.getByLabelText("یادداشت داخلی"), { target: { value: "یادداشت محفوظ" } });
  fireEvent.click(screen.getByRole("radio", { name: "ثبت دریافت کامل و تأیید رزرو" }));
  expect(screen.getByRole("button", { name: "ثبت دریافت کامل و تأیید رزرو" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "ثبت رزرو بدون دریافت وجه" })).toBeNull();
  expect(screen.getByText(/وجه کاملِ از قبل دریافت‌شده/)).toBeTruthy();
  fireEvent.click(info);
  expect(screen.queryByText(/وجه کاملِ از قبل دریافت‌شده/)).toBeNull();
  expect((screen.getByLabelText("یادداشت داخلی") as HTMLTextAreaElement).rows).toBe(2);
  fireEvent.click(screen.getByRole("radio", { name: "ثبت رزرو بدون دریافت وجه" }));
  expect(screen.getByRole("button", { name: "ثبت رزرو بدون دریافت وجه" })).toBeTruthy();
  expect((screen.getByLabelText("یادداشت داخلی") as HTMLTextAreaElement).value).toBe("یادداشت محفوظ");
  expect(mocks.api.mock.calls.filter(([path]) => path === "/admin/reservations")).toHaveLength(0);
});

it("defaults to unchanged unpaid creation even for an authorized receipt actor", async () => {
  await openStay(vi.fn(), 10, undefined, undefined, true); await selectRooms();
  fireEvent.click(screen.getByRole("button", { name: "بررسی نهایی" }));
  expect((screen.getByRole("radio", { name: "ثبت رزرو بدون دریافت وجه" }) as HTMLInputElement).checked).toBe(true);
  expect((screen.getByRole("radio", { name: "ثبت دریافت کامل و تأیید رزرو" }) as HTMLInputElement).checked).toBe(false);
  expect(screen.queryByLabelText("روش دریافت وجه")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "ثبت رزرو بدون دریافت وجه" }));
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
  fireEvent.click(screen.getByRole("button", { name: "توضیح نحوه ثبت رزرو" }));
  expect(screen.getByText(/از مهمان وجهی برداشت نمی‌شود/)).toBeTruthy();
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
  expect(within(result).getAllByText("تایید شده")).toHaveLength(3);
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
  fireEvent.click(screen.getByRole("button", { name: "ثبت رزرو بدون دریافت وجه" }));
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
  const finalSubmit = await screen.findByRole("button", { name: "ثبت رزرو بدون دریافت وجه" });
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
  openGuestCounts();
  fireEvent.click(screen.getByRole("button", { name: "افزایش بزرگسال" }));
  openGuestCounts();
  fireEvent.click(screen.getByRole("button", { name: "افزایش کودک" }));
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
  expect(screen.queryByText("در انتظار تایید")).toBeNull();
  expect(screen.queryByRole("button", { name: "در انتظار تایید" })).toBeNull();
  expect(screen.queryByRole("button", { name: "تایید شده" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "ثبت رزرو بدون دریافت وجه" }));
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
  openGuestCounts();
  expect(screen.getByRole("status", { name: "بزرگسال" }).textContent).toBe("۳");
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
  fireEvent.click(screen.getByRole("button", { name: "ثبت رزرو بدون دریافت وجه" }));
  expect(await screen.findByText("Synthetic save failure")).toBeTruthy();
  expect(screen.getByRole("region", { name: "خلاصه سفارش دستی" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "بازگشت" }));
  fireEvent.click(screen.getByRole("button", { name: "بازگشت" }));
  openGuestCounts();
  expect(screen.getByRole("status", { name: "بزرگسال" }).textContent).toBe("۳");
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
  openGuestCounts();
  fireEvent.click(screen.getByRole("button", { name: "افزایش کودک" }));
  openGuestCounts();
  fireEvent.click(screen.getByRole("button", { name: "افزایش کودک" }));
  fireEvent.change(screen.getByRole("combobox", { name: "سن کودک ۱" }), { target: { value: "4" } });
  fireEvent.change(screen.getByRole("combobox", { name: "سن کودک ۲" }), { target: { value: "8" } });
  fireEvent.click(screen.getByRole("button", { name: /^اقامتگاه/ }));
  fireEvent.click(await screen.findByRole("button", { name: "اقامتگاه دوم" }));
  fireEvent.click(screen.getByRole("button", { name: "انتخاب تاریخ جدید" }));
  openGuestCounts();
  expect(screen.getByRole("status", { name: "بزرگسال" }).textContent).toBe("۳");
  expect((screen.getByLabelText("نوع مهمان") as HTMLSelectElement).value).toBe("Foreign");
  openGuestCounts();
  expect(screen.getByRole("status", { name: "کودک" }).textContent).toBe("۲");
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

it("retains eligible rooms but keeps the requested total when dates reduce named room availability", async () => {
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
  await screen.findByText(/۲ از ۳ اتاق انتخاب شده/);
  expect((screen.getByRole("button", { name: "بررسی نهایی" }) as HTMLButtonElement).disabled).toBe(true);
  expect(mocks.api.mock.calls.some(([path, options]) => path === "/admin/reservations/price-preview" &&
    JSON.parse(options.body).checkInDate === "2035-02-05")).toBe(false);
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

it.each([
  { baseCapacity: 2, maxExtraGuests: 3, base: "۲ نفر", extra: "۳ نفر" },
  { baseCapacity: 0, maxExtraGuests: 0, base: "۰ نفر", extra: "۰ نفر" },
  { baseCapacity: null, maxExtraGuests: null, base: "نامشخص", extra: "نامشخص" },
  { baseCapacity: undefined, maxExtraGuests: undefined, base: "نامشخص", extra: "نامشخص" },
])("displays availability capacities without per-row rules requests: $base / $extra", async values => {
  const original = mocks.api.getMockImplementation()!;
  mocks.api.mockImplementation(async (path: string, ...args: unknown[]) => {
    if (path.includes("available-rooms")) return { options: [{ roomTypeId: 20, name: "دبل",
      inventoryMode: "TypeBasedInventory", availableCount: 7, bookingMode: "Instant", rooms: [],
      baseCapacity: values.baseCapacity, maxExtraGuests: values.maxExtraGuests }], excluded: [] };
    return original(path, ...args);
  });
  await openStay();
  fireEvent.click(screen.getByRole("button", { name: "انتخاب اتاق‌ها" }));
  fireEvent.click(await screen.findByRole("button", { name: "نوع اتاق" }));
  const option = await screen.findByRole("button", { name: /^دبل/ });
  expect(option.textContent).toContain(`ظرفیت پایه: ${values.base}`);
  expect(option.textContent).toContain(`نفر اضافه: ${values.extra}`);
  expect(option.textContent).toContain("۷ واحد موجود");
  expect(mocks.api.mock.calls.some(([path]) => path.includes("effective-rules"))).toBe(false);
});

it("selects a single type without auto-selection, removes it with trash and preserves it across steps", async () => {
  const original = mocks.api.getMockImplementation()!;
  mocks.api.mockImplementation(async (path: string, ...args: unknown[]) => {
    if (path.includes("available-rooms")) return { options: [{ roomTypeId: 20, name: "دبل",
      inventoryMode: "TypeBasedInventory", availableCount: 2, bookingMode: "Instant", rooms: [] }], excluded: [] };
    const result = await original(path, ...args);
    if (path === "/admin/reservations/price-preview") return { ...result, roomCount: 1, finalAmount: 200, roomPrices: [result.roomPrices[0]] };
    return result;
  });
  await openStay();
  for (let index = 0; index < 2; index++) {
    fireEvent.click(screen.getByRole("button", { name: "کاهش تعداد اتاق" }));
    fireEvent.click(screen.getByRole("button", { name: "کاهش بزرگسال" }));
  }
  fireEvent.click(screen.getByRole("button", { name: "انتخاب اتاق‌ها" }));
  await screen.findByRole("button", { name: "نوع اتاق" });
  expect(screen.queryByRole("group", { name: "انتخاب دبل" })).toBeNull();
  expect(screen.queryByRole("spinbutton")).toBeNull();
  expect(screen.queryByRole("status", { name: "تعداد دبل" })).toBeNull();
  expect(screen.queryByRole("list", { name: "خلاصه تخصیص اتاق‌ها" })).toBeNull();
  expect(screen.getByText("۰ از ۱ اتاق انتخاب شده")).toBeTruthy();
  expect(mocks.api.mock.calls.some(([path]) => path === "/admin/reservations/price-preview")).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "نوع اتاق" }));
  const option = await screen.findByRole("button", { name: /^دبل/ });
  expect(option.textContent).toContain("ظرفیت پایه: نامشخص");
  expect(option.textContent).toContain("نفر اضافه: نامشخص");
  expect(option.textContent).toContain("۲ واحد موجود");
  await selectType("دبل");
  const increase = screen.getByRole("button", { name: "افزایش تعداد دبل" });
  await waitFor(() => expect((screen.getByRole("button", { name: "بررسی نهایی" }) as HTMLButtonElement).disabled).toBe(false));
  expect(screen.getByRole("button", { name: /^دبل/ }).textContent).toContain("ظرفیت پایه: نامشخص");
  expect(screen.getByRole("button", { name: /^دبل/ }).textContent).toContain("نفر اضافه: نامشخص");
  expect((increase as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByRole("list", { name: "خلاصه تخصیص اتاق‌ها" }).textContent).toBe("دبل × ۱");
  fireEvent.click(screen.getByRole("button", { name: "حذف دبل" }));
  expect(screen.queryByRole("group", { name: "انتخاب دبل" })).toBeNull();
  expect(screen.queryByRole("status", { name: "تعداد دبل" })).toBeNull();
  expect((screen.getByRole("button", { name: "بررسی نهایی" }) as HTMLButtonElement).disabled).toBe(true);
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "نوع اتاق" })));
  await selectType("دبل");
  await waitFor(() => expect((screen.getByRole("button", { name: "بررسی نهایی" }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole("button", { name: "بررسی نهایی" }));
  fireEvent.click(screen.getByRole("button", { name: "بازگشت" }));
  expect(screen.getByRole("status", { name: "تعداد دبل" }).textContent).toBe("۱");
  fireEvent.click(screen.getByRole("button", { name: "بازگشت" }));
  fireEvent.click(screen.getByRole("button", { name: "انتخاب اتاق‌ها" }));
  expect((await screen.findByRole("status", { name: "تعداد دبل" })).textContent).toBe("۱");
});

it("limits mixed type counters by inventory and the shared requested total and summarizes each type", async () => {
  const original = mocks.api.getMockImplementation()!;
  mocks.api.mockImplementation(async (path: string, ...args: unknown[]) => {
    if (path.includes("available-rooms")) return { options: [
      { roomTypeId: 20, name: "دبل", inventoryMode: "TypeBasedInventory", availableCount: 1, bookingMode: "Instant", rooms: [] },
      { roomTypeId: 21, name: "سوئیت", inventoryMode: "TypeBasedInventory", availableCount: 3, bookingMode: "Instant", rooms: [] },
      { roomTypeId: 22, name: "تک", inventoryMode: "TypeBasedInventory", availableCount: 2, bookingMode: "Instant", rooms: [] },
    ], excluded: [] };
    const result = await original(path, ...args);
    if (path.includes("effective-rules")) return { ...result, roomTypeId: Number(new URL(path, "http://test").searchParams.get("roomTypeId")) };
    return result;
  });
  await openStay();
  fireEvent.click(screen.getByRole("button", { name: "انتخاب اتاق‌ها" }));
  await selectType("دبل");
  const double = screen.getByRole("button", { name: "افزایش تعداد دبل" }) as HTMLButtonElement;
  expect(double.disabled).toBe(true);
  const search = screen.getByPlaceholderText("جستجوی نوع اتاق...");
  expect(screen.getByRole("button", { name: "نوع اتاق" }).getAttribute("aria-expanded")).toBe("true");
  expect(screen.queryByRole("button", { name: "انتخاب همه" })).toBeNull();
  fireEvent.change(search, { target: { value: "سوئیت" } });
  expect(screen.getByRole("status", { name: "تعداد دبل" }).textContent).toBe("۱");
  await selectType("سوئیت");
  const suite = screen.getByRole("button", { name: "افزایش تعداد سوئیت" }) as HTMLButtonElement;
  expect(screen.getByText("۲ از ۳ اتاق انتخاب شده")).toBeTruthy();
  expect((screen.getByRole("button", { name: "بررسی نهایی" }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(suite);
  expect(double.disabled).toBe(true); expect(suite.disabled).toBe(true);
  fireEvent.change(search, { target: { value: "تک" } });
  expect((screen.getByRole("button", { name: /^تک/ }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(suite); // Disabled controls must not over-allocate.
  expect(screen.getByRole("status", { name: "تعداد سوئیت" }).textContent).toBe("۲");
  const summary = screen.getByRole("list", { name: "خلاصه تخصیص اتاق‌ها" });
  expect(within(summary).getAllByRole("listitem").map(item => item.textContent)).toEqual(["دبل × ۱", "سوئیت × ۲"]);
  await waitFor(() => expect((screen.getByRole("button", { name: "بررسی نهایی" }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole("button", { name: "کاهش تعداد سوئیت" }));
  expect(suite.disabled).toBe(false);
  expect(screen.getByText("۲ از ۳ اتاق انتخاب شده")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "کاهش تعداد سوئیت" })).toBeNull();
  fireEvent.change(search, { target: { value: "سوئیت" } });
  expect(screen.getByRole("button", { name: /^سوئیت/ }).getAttribute("aria-pressed")).toBe("true");
  fireEvent.click(screen.getByRole("button", { name: "حذف سوئیت" }));
  expect(screen.queryByRole("group", { name: "انتخاب سوئیت" })).toBeNull();
  expect(screen.getByRole("button", { name: /^سوئیت/ }).getAttribute("aria-pressed")).toBe("false");
  expect(screen.getByText("۱ از ۳ اتاق انتخاب شده")).toBeTruthy();
  fireEvent.change(search, { target: { value: "دبل" } });
  fireEvent.click(screen.getByRole("button", { name: /^دبل/ }));
  expect(screen.queryByRole("group", { name: "انتخاب دبل" })).toBeNull();
  expect(screen.getByRole("button", { name: /^دبل/ }).getAttribute("aria-pressed")).toBe("false");
  expect(screen.getByText("۰ از ۳ اتاق انتخاب شده")).toBeTruthy();
});

it("books TypeBased quantities without physical room IDs and keeps mixed missing-price feedback visible", async () => {
  const original = mocks.api.getMockImplementation()!;
  mocks.api.mockImplementation((path: string, ...args: unknown[]) => path.includes("available-rooms")
    ? Promise.resolve({ options: [{ roomTypeId: 20, name: "سوئیت تعدادی", inventoryMode: "TypeBasedInventory",
      availableCount: 3, bookingMode: "Instant", rooms: [] }], excluded: [{ roomTypeId: 21, name: "بدون نرخ",
      reason: "MissingNightlyPricing", missingDates: ["2035-02-02"] }] }) : original(path, ...args));
  await openStay();
  fireEvent.click(screen.getByRole("button", { name: "انتخاب اتاق‌ها" }));
  await screen.findByRole("button", { name: "نوع اتاق" });
  expect(screen.getByText(/قیمت معتبر برای شب‌های/).textContent).toContain("۲۰۳۵-۰۲-۰۲");
  expect(screen.queryByRole("button", { name: /^اتاق/ })).toBeNull();
  await selectType("سوئیت تعدادی");
  fireEvent.click(screen.getByRole("button", { name: "افزایش تعداد سوئیت تعدادی" }));
  expect((screen.getByRole("button", { name: "بررسی نهایی" }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "افزایش تعداد سوئیت تعدادی" }));
  expect((screen.getByRole("button", { name: "افزایش تعداد سوئیت تعدادی" }) as HTMLButtonElement).disabled).toBe(true);
  await waitFor(() => expect((screen.getByRole("button", { name: "بررسی نهایی" }) as HTMLButtonElement).disabled).toBe(false));
  const preview = mocks.api.mock.calls.filter(([path]) => path === "/admin/reservations/price-preview").at(-1)!;
  expect(JSON.parse(preview[1].body)).toMatchObject({ forManualCreation: true, roomTypeId: 20, roomCount: 3 });
  fireEvent.click(screen.getByRole("button", { name: "بررسی نهایی" }));
  expect(within(screen.getByRole("list", { name: "قیمت اتاق‌های انتخاب‌شده" })).getAllByRole("listitem")).toHaveLength(3);
  fireEvent.click(screen.getByRole("button", { name: "ثبت رزرو بدون دریافت وجه" }));
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
  await selectType("سوئیت تعدادی");
  for (let index = 0; index < 2; index++) fireEvent.click(screen.getByRole("button", { name: "افزایش تعداد سوئیت تعدادی" }));
  await waitFor(() => expect((screen.getByRole("button", { name: "بررسی نهایی" }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole("button", { name: "بازگشت" }));
  fireEvent.click(screen.getByRole("button", { name: "انتخاب اتاق‌ها" }));
  expect((await screen.findByRole("status", { name: "تعداد سوئیت تعدادی" })).textContent).toBe("۳");
  fireEvent.click(screen.getByRole("button", { name: "بازگشت" }));
  fireEvent.click(screen.getByRole("button", { name: "انتخاب تاریخ جدید" }));
  openGuestCounts();
  expect(screen.getByRole("status", { name: "بزرگسال" }).textContent).toBe("۳");
  fireEvent.click(screen.getByRole("button", { name: "انتخاب اتاق‌ها" }));
  expect((await screen.findByRole("status", { name: "تعداد سوئیت تعدادی" })).textContent).toBe("۲");
  expect(screen.getByText(/۲ از ۳ اتاق انتخاب شده/)).toBeTruthy();
  expect((screen.getByRole("button", { name: "بررسی نهایی" }) as HTMLButtonElement).disabled).toBe(true);
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
  fireEvent.click(screen.getByRole("button", { name: "ثبت رزرو بدون دریافت وجه" }));
  const result = await screen.findByRole("dialog", { name: "سفارش دستی ثبت شد" });
  expect(result).toBe(originalDialog);
  expect(screen.getAllByRole("dialog")).toHaveLength(1);
  expect(document.getElementById("manual-reservation-form")).toBeNull();
  expect(within(result).queryByRole("list", { name: "مراحل ایجاد رزرو" })).toBeNull();
  expect(result.querySelector("svg[aria-hidden=true] path")).not.toBeNull();
  const rows = within(result).getByRole("list", { name: "رزروهای ایجادشده" });
  expect(within(rows).getAllByRole("listitem").map(row => row.textContent)).toEqual([
    expect.stringContaining("در انتظار"), expect.stringContaining("در انتظار تایید"), expect.stringContaining("در انتظار تایید"),
  ]);
  expect(within(result).queryByRole("button", { name: "ثبت رزرو بدون دریافت وجه" })).toBeNull();
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
  fireEvent.click(screen.getByRole("button", { name: "ثبت رزرو بدون دریافت وجه" }));
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
  expect(screen.getByRole("button", { name: /^مهمانان و اتاق‌ها:/ }).getAttribute("aria-expanded")).toBe("false");
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
  fireEvent.click(screen.getByRole("button", { name: "ثبت رزرو بدون دریافت وجه" }));
  const result = await screen.findByRole("dialog", { name: "سفارش دستی ثبت شد" });
  expect(canReview).toHaveBeenCalledWith(10);
  expect(within(result).queryByRole("button", { name: /بررسی و تأیید/ })).toBeNull();
  expect(within(result).getAllByRole("link")).toHaveLength(3);
  expect(reviewAction).not.toHaveBeenCalled();
});
