import dayjs from "dayjs";
import jalaliday from "jalaliday/dayjs";
import { describe, expect, it, vi } from "vitest";
import {
  getVisibleMonthGregorianRange,
  holidayCalendarRangeKey,
  type HolidayCalendarDaysResponse,
} from "@/lib/holiday-calendar";
import { createHolidayCalendarRangeLoader } from "@/hooks/useHolidayCalendarMonths";
import { holidayDayStateClass } from "@/components/HolidayCalendarDayContent";

dayjs.extend(jalaliday);

function response(from: string, to: string): HolidayCalendarDaysResponse {
  return {
    from,
    to,
    isRangeFullyCovered: true,
    coveredSolarYearFrom: 1405,
    coveredSolarYearTo: 1407,
    lastSuccessfulSyncAtUtc: "2026-07-28T06:00:00Z",
    days: [],
  };
}

describe("visible holiday calendar range", () => {
  it("calculates one visible Jalali month", () => {
    const range = getVisibleMonthGregorianRange(
      dayjs("1405-01-01", { jalali: true }),
      "jalali",
      1,
    );

    expect(range).toEqual({ from: "2026-03-21", to: "2026-04-20" });
  });

  it("calculates the complete two-month desktop range", () => {
    const range = getVisibleMonthGregorianRange(
      dayjs("1405-01-01", { jalali: true }),
      "jalali",
      2,
    );

    expect(range).toEqual({ from: "2026-03-21", to: "2026-05-21" });
  });

  it("crosses a Jalali year boundary without gaps", () => {
    const range = getVisibleMonthGregorianRange(
      dayjs("1404-12-01", { jalali: true }),
      "jalali",
      2,
    );

    expect(range).toEqual({ from: "2026-02-20", to: "2026-04-20" });
  });

  it("keeps supported visible ranges within the 93-day API limit", () => {
    const range = getVisibleMonthGregorianRange(
      dayjs("1405-06-01", { jalali: true }),
      "jalali",
      2,
    );
    const inclusiveDays = dayjs(range.to).diff(dayjs(range.from), "day") + 1;

    expect(inclusiveDays).toBeLessThanOrEqual(93);
  });
});

describe("holiday calendar range loader", () => {
  it("reuses a completed range", async () => {
    const fetcher = vi.fn(async (from: string, to: string) => response(from, to));
    const loader = createHolidayCalendarRangeLoader(fetcher);
    const range = { from: "2026-03-21", to: "2026-04-20" };

    await loader.load(range);
    await loader.load(range);

    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("deduplicates an in-flight range", async () => {
    let resolveRequest!: (value: HolidayCalendarDaysResponse) => void;
    const fetcher = vi.fn(
      () =>
        new Promise<HolidayCalendarDaysResponse>((resolve) => {
          resolveRequest = resolve;
        }),
    );
    const loader = createHolidayCalendarRangeLoader(fetcher);
    const range = { from: "2026-03-21", to: "2026-04-20" };

    const first = loader.load(range);
    const second = loader.load(range);

    expect(first).toBe(second);
    expect(fetcher).toHaveBeenCalledTimes(1);
    resolveRequest(response(range.from, range.to));
    await first;
  });

  it("cancels an obsolete in-flight range", async () => {
    let capturedSignal: AbortSignal | undefined;
    const fetcher = vi.fn(
      (_from: string, _to: string, signal?: AbortSignal) =>
        new Promise<HolidayCalendarDaysResponse>((_resolve, reject) => {
          capturedSignal = signal;
          signal?.addEventListener("abort", () =>
            reject(new DOMException("Aborted", "AbortError")),
          );
        }),
    );
    const loader = createHolidayCalendarRangeLoader(fetcher);
    const obsoleteRange = { from: "2026-03-21", to: "2026-04-20" };
    const pending = loader.load(obsoleteRange);

    loader.cancelExcept(
      holidayCalendarRangeKey({ from: "2026-04-21", to: "2026-05-21" }),
    );

    expect(capturedSignal?.aborted).toBe(true);
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });
});

describe("holiday visual precedence", () => {
  it("keeps disabled styling above range and holiday styling", () => {
    const className = holidayDayStateClass(
      { selected: false, disabled: true, today: false, inRange: true },
      {
        date: "2026-03-21",
        solarYear: 1405,
        solarMonth: 1,
        solarDay: 1,
        isHoliday: true,
        isWeeklyHoliday: false,
        isOfficialHoliday: true,
        occasionTitles: ["Nowruz"],
      },
      "text-foreground",
    );

    expect(className).toContain("text-muted-foreground");
    expect(className).not.toContain("text-destructive");
    expect(className).not.toContain("theme-primary-text");
  });
});
