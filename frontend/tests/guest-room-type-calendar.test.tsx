import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import dayjs from "dayjs";
import jalaliday from "jalaliday/dayjs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PublicRoomTypeCalendarDialog } from "@/components/booking/PublicRoomTypeCalendarDialog";
import type { PublicRoomType } from "@/lib/public-properties";

dayjs.extend(jalaliday);

const mocks = vi.hoisted(() => ({ fetchCalendar: vi.fn(), currencyLabel: "تومان" }));
vi.mock("@/lib/public-properties", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/public-properties")>();
  return { ...actual, fetchPublicRoomTypeCalendar: mocks.fetchCalendar };
});
vi.mock("@/lib/currency", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/currency")>();
  return { ...actual, useSiteCurrencyLabel: () => mocks.currencyLabel };
});

const roomType = { id: 13, name: "تویین" } as PublicRoomType;
const secondRoomType = { id: 14, name: "دابل" } as PublicRoomType;

function response(roomTypeId = 13) {
  const start = dayjs("2026-10-10").calendar("jalali").date(1);
  const next = start.add(1, "month");
  const toIso = (value: dayjs.Dayjs) => value.calendar("gregory").format("YYYY-MM-DD");
  return {
    roomTypeId,
    from: toIso(start),
    to: toIso(next.add(1, "month").subtract(1, "day")),
    days: [
      { date: toIso(start), standardPrice: 3_000_000, availableUnits: 2, availabilityStatus: "Available" },
      { date: toIso(start.add(1, "day")), standardPrice: null, availableUnits: 1, availabilityStatus: "OnRequest" },
      { date: toIso(start.add(2, "day")), standardPrice: 0, availableUnits: 0, availabilityStatus: "Unavailable" },
      { date: toIso(start.add(6, "day")), standardPrice: 1_000_000, availableUnits: 2, availabilityStatus: "Available" },
      { date: toIso(start.add(17, "day")), standardPrice: 2_000_000, availableUnits: 2, availabilityStatus: "Available" },
      { date: toIso(next), standardPrice: 4_000_000, availableUnits: 3, availabilityStatus: "Available" },
    ],
  };
}

describe("guest RoomType calendar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.currencyLabel = "تومان";
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-10T12:00:00"));
    mocks.fetchCalendar.mockResolvedValue(response());
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("uses the public backend calendar endpoint with encoded property slug and bounded query", async () => {
    const actual = await vi.importActual<typeof import("@/lib/public-properties")>("@/lib/public-properties");
    const fetchRequest = vi.fn().mockResolvedValue({ ok: true, json: async () => response() });
    vi.stubGlobal("fetch", fetchRequest);
    const result = response();
    await actual.fetchPublicRoomTypeCalendar("خانه کاشان", 13, result.from, result.to);
    expect(fetchRequest).toHaveBeenCalledExactlyOnceWith(
      `/api/backend/properties/${encodeURIComponent("خانه کاشان")}/room-types/13/calendar?from=${result.from}&to=${result.to}`,
    );
  });

  it("requests one bounded current-and-next Jalali month range only when opened", async () => {
    const view = render(<PublicRoomTypeCalendarDialog onClose={vi.fn()} propertySlug="kashan-house" roomType={null} />);
    expect(mocks.fetchCalendar).not.toHaveBeenCalled();
    view.rerender(<PublicRoomTypeCalendarDialog onClose={vi.fn()} propertySlug="kashan-house" roomType={roomType} />);
    const result = response();
    await waitFor(() => expect(mocks.fetchCalendar).toHaveBeenCalledExactlyOnceWith("kashan-house", 13, result.from, result.to));
    expect(dayjs(result.to).diff(dayjs(result.from), "day") + 1).toBeLessThanOrEqual(63);
    expect(await screen.findByRole("heading", { name: "تقویم قیمت و موجودی — تویین" })).toBeTruthy();
  });

  it("scales only displayed prices and keeps null, zero, statuses, and past dates clear", async () => {
    render(<PublicRoomTypeCalendarDialog onClose={vi.fn()} propertySlug="kashan-house" roomType={roomType} />);
    const calendar = await screen.findByRole("dialog");
    await within(calendar).findByText("۳٬۰۰۰");
    expect(calendar.className).toContain("sm:!max-w-xl");
    expect(calendar.className).toContain("w-[calc(100vw-2rem)]");
    expect(calendar.querySelector(".min-w-\\[420px\\]"))?.toBeTruthy();
    expect(within(calendar).getByText("واحد قیمت‌ها: هزار تومان")).toBeTruthy();
    expect(within(calendar).getByText("۳٬۰۰۰")).toBeTruthy();
    expect(within(calendar).queryByText("۳٬۰۰۰٬۰۰۰ تومان")).toBeNull();
    expect(within(calendar).getAllByText("—").length).toBeGreaterThan(0);
    expect(within(calendar).getByText("۰")).toBeTruthy();
    expect(within(calendar).queryByText("موجود")).toBeNull();
    expect(within(calendar).queryByText("۲ واحد")).toBeNull();
    expect(within(calendar).getByText("درخواست رزرو")).toBeTruthy();
    expect(within(calendar).getAllByText("ناموجود").length).toBeGreaterThan(0);
    expect(within(calendar).queryByText("⚡")).toBeNull();
    const dayGroups = within(calendar).getAllByRole("group", { name: /نرخ/ });
    expect(dayGroups[0].className).toContain("bg-muted");
    expect(dayGroups[0].querySelector(".text-muted-foreground")?.textContent).toContain("۱");
    expect(dayGroups[0].hasAttribute("aria-pressed")).toBe(false);
    expect(dayGroups[0].className).not.toContain("ring-primary");
    expect(within(calendar).queryByRole("button", { name: /نرخ/ })).toBeNull();
    expect(dayGroups[0].parentElement?.className).toContain("grid-cols-7");
    expect(dayGroups[0].className).toContain("min-h-14");
    expect(response().days[0].standardPrice).toBe(3_000_000);
  });

  it("shows Persian Jalali day digits without changing the underlying dates or availability", async () => {
    render(<PublicRoomTypeCalendarDialog onClose={vi.fn()} propertySlug="kashan-house" roomType={roomType} />);
    await screen.findByText("۳٬۰۰۰");
    const singleDigitDate = dayjs("2026-10-10").calendar("jalali").date(7).calendar("gregory").format("YYYY-MM-DD");
    const eighteenthDate = dayjs("2026-10-10").calendar("jalali").date(18).calendar("gregory").format("YYYY-MM-DD");
    const groups = screen.getAllByRole("group", { name: /نرخ/ });
    const singleDigitDay = groups.find((group) => group.getAttribute("aria-label")?.includes("/07/07"));
    const eighteenthDay = groups.find((group) => group.getAttribute("aria-label")?.includes("/07/18"));
    expect(singleDigitDay).toBeTruthy();
    expect(eighteenthDay).toBeTruthy();
    expect(within(singleDigitDay!).getByText("۷")).toBeTruthy();
    expect(within(eighteenthDay!).getByText("۱۸")).toBeTruthy();
    expect(within(eighteenthDay!).queryByText("موجود")).toBeNull();
    expect(response().days.some((day) => day.date === singleDigitDate)).toBe(true);
    expect(response().days.some((day) => day.date === eighteenthDate)).toBe(true);
    expect(response().days.find((day) => day.date === eighteenthDate)?.availabilityStatus).toBe("Available");
    expect(mocks.fetchCalendar).toHaveBeenCalledWith("kashan-house", 13, response().from, response().to);
  });

  it("derives the thousands unit from the configured currency label", async () => {
    mocks.currencyLabel = "ریال آزمایشی";
    render(<PublicRoomTypeCalendarDialog onClose={vi.fn()} propertySlug="kashan-house" roomType={roomType} />);
    expect(await screen.findByText("واحد قیمت‌ها: هزار ریال آزمایشی")).toBeTruthy();
    expect(screen.getByText("۳٬۰۰۰")).toBeTruthy();
  });

  it("switches to next month without another request and caches successful reopening", async () => {
    const view = render(<PublicRoomTypeCalendarDialog onClose={vi.fn()} propertySlug="kashan-house" roomType={roomType} />);
    await screen.findByText("۳٬۰۰۰");
    fireEvent.click(screen.getByRole("button", { name: "ماه بعد" }));
    expect(screen.getByText("۴٬۰۰۰")).toBeTruthy();
    expect(mocks.fetchCalendar).toHaveBeenCalledTimes(1);
    view.rerender(<PublicRoomTypeCalendarDialog onClose={vi.fn()} propertySlug="kashan-house" roomType={null} />);
    view.rerender(<PublicRoomTypeCalendarDialog onClose={vi.fn()} propertySlug="kashan-house" roomType={roomType} />);
    await screen.findByText("۳٬۰۰۰");
    expect(mocks.fetchCalendar).toHaveBeenCalledTimes(1);
    mocks.fetchCalendar.mockResolvedValue(response(14));
    view.rerender(<PublicRoomTypeCalendarDialog onClose={vi.fn()} propertySlug="kashan-house" roomType={secondRoomType} />);
    await waitFor(() => expect(mocks.fetchCalendar).toHaveBeenCalledTimes(2));
    expect(mocks.fetchCalendar.mock.calls[1][1]).toBe(14);
  });

  it("keeps the dialog open on failure and retries on demand", async () => {
    let reject!: (error: Error) => void;
    mocks.fetchCalendar.mockReturnValueOnce(new Promise((_resolve, rejectPromise) => { reject = rejectPromise; }));
    render(<PublicRoomTypeCalendarDialog onClose={vi.fn()} propertySlug="kashan-house" roomType={roomType} />);
    expect((await screen.findByRole("status")).textContent).toContain("در حال دریافت تقویم");
    reject(new Error("network"));
    await screen.findByText(/دریافت تقویم انجام نشد/);
    expect(screen.getByRole("dialog")).toBeTruthy();
    mocks.fetchCalendar.mockResolvedValueOnce(response());
    fireEvent.click(screen.getByRole("button", { name: "تلاش دوباره" }));
    await screen.findByText("۳٬۰۰۰");
    expect(mocks.fetchCalendar).toHaveBeenCalledTimes(2);
  });
});
