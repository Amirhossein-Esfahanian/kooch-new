import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import dayjs from "dayjs";
import jalaliday from "jalaliday/dayjs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PublicRoomTypeCalendarDialog } from "@/components/booking/PublicRoomTypeCalendarDialog";
import type { PublicRoomType } from "@/lib/public-properties";

dayjs.extend(jalaliday);

const mocks = vi.hoisted(() => ({ fetchCalendar: vi.fn() }));
vi.mock("@/lib/public-properties", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/public-properties")>();
  return { ...actual, fetchPublicRoomTypeCalendar: mocks.fetchCalendar };
});
vi.mock("@/lib/currency", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/currency")>();
  return { ...actual, useSiteCurrencyLabel: () => "ریال آزمایشی" };
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
      { date: toIso(next), standardPrice: 4_000_000, availableUnits: 3, availabilityStatus: "Available" },
    ],
  };
}

describe("guest RoomType calendar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

  it("shows authoritative full prices, missing price, zero, statuses, and noninteractive past dates", async () => {
    render(<PublicRoomTypeCalendarDialog onClose={vi.fn()} propertySlug="kashan-house" roomType={roomType} />);
    const calendar = await screen.findByRole("dialog");
    await within(calendar).findByText("۳٬۰۰۰٬۰۰۰ ریال آزمایشی");
    expect(within(calendar).getByText("۳٬۰۰۰٬۰۰۰ ریال آزمایشی")).toBeTruthy();
    expect(within(calendar).getAllByText("—").length).toBeGreaterThan(0);
    expect(within(calendar).getByText("۰ ریال آزمایشی")).toBeTruthy();
    expect(within(calendar).getByText("۲ واحد")).toBeTruthy();
    expect(within(calendar).getByText("درخواست رزرو")).toBeTruthy();
    expect(within(calendar).getAllByText("ناموجود").length).toBeGreaterThan(0);
    const dayGroups = within(calendar).getAllByRole("group", { name: /نرخ/ });
    expect(dayGroups[0].className).toContain("bg-muted");
    expect(dayGroups[0].hasAttribute("aria-pressed")).toBe(false);
    expect(dayGroups[0].className).not.toContain("ring-primary");
    expect(within(calendar).queryByRole("button", { name: /نرخ/ })).toBeNull();
  });

  it("switches to next month without another request and caches successful reopening", async () => {
    const view = render(<PublicRoomTypeCalendarDialog onClose={vi.fn()} propertySlug="kashan-house" roomType={roomType} />);
    await screen.findByText("۳٬۰۰۰٬۰۰۰ ریال آزمایشی");
    fireEvent.click(screen.getByRole("button", { name: "ماه بعد" }));
    expect(screen.getByText("۴٬۰۰۰٬۰۰۰ ریال آزمایشی")).toBeTruthy();
    expect(mocks.fetchCalendar).toHaveBeenCalledTimes(1);
    view.rerender(<PublicRoomTypeCalendarDialog onClose={vi.fn()} propertySlug="kashan-house" roomType={null} />);
    view.rerender(<PublicRoomTypeCalendarDialog onClose={vi.fn()} propertySlug="kashan-house" roomType={roomType} />);
    await screen.findByText("۳٬۰۰۰٬۰۰۰ ریال آزمایشی");
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
    await screen.findByText("۳٬۰۰۰٬۰۰۰ ریال آزمایشی");
    expect(mocks.fetchCalendar).toHaveBeenCalledTimes(2);
  });
});
