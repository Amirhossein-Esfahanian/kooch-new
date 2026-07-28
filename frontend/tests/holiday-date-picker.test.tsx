import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SharedDateRangePicker } from "@/components/SharedDateRangePicker";
import { SharedSingleDatePicker } from "@/components/SharedSingleDatePicker";
import type { HolidayCalendarDay } from "@/lib/holiday-calendar";

function setDesktopViewport(matches: boolean) {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

function holidayDay(
  date: string,
  kind: "official" | "weekly",
  occasionTitles: readonly string[] = [],
): HolidayCalendarDay {
  return {
    date,
    solarYear: 1405,
    solarMonth: 1,
    solarDay: Number(date.slice(-2)),
    isHoliday: true,
    isWeeklyHoliday: kind === "weekly",
    isOfficialHoliday: kind === "official",
    occasionTitles,
  };
}

function installHolidayFetch(days: readonly HolidayCalendarDay[]) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input), "http://localhost");
    const from = url.searchParams.get("from")!;
    const to = url.searchParams.get("to")!;
    return new Response(
      JSON.stringify({
        from,
        to,
        isRangeFullyCovered: true,
        coveredSolarYearFrom: 1405,
        coveredSolarYearTo: 1407,
        lastSuccessfulSyncAtUtc: "2026-07-28T06:00:00Z",
        days,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function openSinglePicker(
  props: Partial<React.ComponentProps<typeof SharedSingleDatePicker>> = {},
) {
  const onChange = vi.fn();
  const rendered = render(
    <SharedSingleDatePicker
      confirmText="Confirm"
      onChange={onChange}
      value="2026-03-21"
      {...props}
    />,
  );
  fireEvent.click(rendered.container.querySelector("button")!);
  return { ...rendered, onChange };
}

async function findCalendarDay(date: string) {
  return waitFor(() => {
    const button = document.querySelector<HTMLButtonElement>(
      `[data-calendar-date="${date}"]`,
    );
    expect(button).not.toBeNull();
    return button!;
  });
}

describe("holiday date-picker presentation", () => {
  beforeEach(() => setDesktopViewport(false));

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("keeps an official holiday selectable", async () => {
    installHolidayFetch([holidayDay("2026-03-21", "official", ["Nowruz"])]);
    const { onChange } = openSinglePicker();
    const day = await findCalendarDay("2026-03-21");

    fireEvent.click(day);
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));

    expect(day.disabled).toBe(false);
    expect(onChange).toHaveBeenCalledWith("2026-03-21");
  });

  it("shows official titles on desktop and exposes them on keyboard focus", async () => {
    setDesktopViewport(true);
    installHolidayFetch([holidayDay("2026-03-21", "official", ["Nowruz", "Spring day"])]);
    openSinglePicker();
    const day = await findCalendarDay("2026-03-21");

    day.focus();

    expect(document.activeElement).toBe(day);
    expect(day.getAttribute("aria-label")).toContain("Nowruz");
    expect(day.querySelector("[data-holiday-tooltip]")?.textContent).toContain("Spring day");
  });

  it("marks an ordinary Friday without creating an empty title tooltip", async () => {
    installHolidayFetch([holidayDay("2026-03-27", "weekly")]);
    openSinglePicker({ value: "2026-03-27" });
    const day = await findCalendarDay("2026-03-27");

    expect(day.dataset.holidayKind).toBe("weekly");
    expect(day.querySelector("[data-holiday-marker]")).not.toBeNull();
    expect(day.querySelector("[data-holiday-tooltip]")).toBeNull();
    expect(day.getAttribute("aria-label")).not.toContain(":");
  });

  it("keeps selected and disabled styles above holiday styling", async () => {
    installHolidayFetch([
      holidayDay("2026-03-21", "official", ["Selected holiday"]),
      holidayDay("2026-03-22", "official", ["Disabled holiday"]),
    ]);
    openSinglePicker({ disabledDates: ["2026-03-22"] });
    const selectedDay = await findCalendarDay("2026-03-21");
    const disabledDay = await findCalendarDay("2026-03-22");

    expect(selectedDay.className).toContain("bg-[var(--theme-primary)]");
    expect(selectedDay.className).not.toContain("text-destructive");
    expect(disabledDay.disabled).toBe(true);
    expect(disabledDay.className).toContain("text-muted-foreground");
    expect(disabledDay.className).not.toContain("text-destructive");
  });

  it("shows tapped official titles on mobile without requiring hover", async () => {
    installHolidayFetch([holidayDay("2026-03-21", "official", ["Nowruz"])]);
    openSinglePicker();
    const day = await findCalendarDay("2026-03-21");

    fireEvent.click(day);

    expect(document.querySelector("[data-mobile-holiday-details]")?.textContent).toBe("Nowruz");
  });

  it("leaves selection usable when the holiday API fails", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("Network unavailable"));
    vi.stubGlobal("fetch", fetchMock);
    const { onChange } = openSinglePicker();
    const day = await findCalendarDay("2026-03-21");
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());

    fireEvent.click(day);
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));

    expect(day.dataset.holiday).toBeUndefined();
    expect(onChange).toHaveBeenCalledWith("2026-03-21");
  });

  it("requests both visible months for the desktop range picker", async () => {
    setDesktopViewport(true);
    const fetchMock = installHolidayFetch([]);
    const rendered = render(
      <SharedDateRangePicker
        onChange={vi.fn()}
        value={{ startDate: "2026-03-21", endDate: null }}
      />,
    );

    fireEvent.click(rendered.container.querySelector("button")!);

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const requestedUrl = new URL(String(fetchMock.mock.calls.at(-1)?.[0]), "http://localhost");
    expect(requestedUrl.searchParams.get("from")).toBe("2026-03-21");
    expect(requestedUrl.searchParams.get("to")).toBe("2026-05-21");
  });
});
