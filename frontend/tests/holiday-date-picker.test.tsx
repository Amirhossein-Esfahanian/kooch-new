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

function focusCalendarDay(day: HTMLButtonElement) {
  day.focus();
  fireEvent.focus(day);
}

function expectNonWrappingActionGroup(actionGroup: HTMLElement) {
  const classTokens = new Set(actionGroup.className.split(/\s+/));
  const actionButtons = Array.from(
    actionGroup.querySelectorAll<HTMLButtonElement>("button"),
  );

  expect(classTokens.has("flex-nowrap")).toBe(true);
  expect(classTokens.has("flex-wrap")).toBe(false);
  expect(classTokens.has("items-center")).toBe(true);
  expect(classTokens.has("whitespace-nowrap")).toBe(true);
  expect(actionButtons).toHaveLength(2);
  expect(actionButtons.every((button) => button.parentElement === actionGroup)).toBe(
    true,
  );
  expect(
    actionButtons.every((button) =>
      button.className.split(/\s+/).includes("shrink-0"),
    ),
  ).toBe(true);
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

  it("shows multiple official titles in the fixed footer on keyboard focus", async () => {
    setDesktopViewport(true);
    installHolidayFetch([
      holidayDay("2026-03-21", "official", [
        "Nowruz [provider note]",
        "Spring day",
        "Nowruz",
        "[hidden note]",
        "Spring day",
        "Day (observed)",
      ]),
    ]);
    openSinglePicker();
    const day = await findCalendarDay("2026-03-21");

    focusCalendarDay(day);

    const desktopDetailsRegion = document.querySelector<HTMLElement>(
      "[data-desktop-holiday-details]",
    )!;
    const details = desktopDetailsRegion.querySelector<HTMLElement>(
      "[data-holiday-details-content]",
    );
    expect(document.activeElement).toBe(day);
    expect(day.getAttribute("aria-label")).toContain("Nowruz [provider note]");
    expect(details?.textContent).toBe(
      "Nowruz • Spring day • Day (observed)",
    );
    expect(details?.textContent).not.toContain("[");
    expect(details?.className).toContain("line-clamp-2");
    expect(details?.className).toContain("w-full");
    expect(details?.className).toContain("[overflow-wrap:anywhere]");
    expect(details?.closest("[data-holiday-details]")?.className).toContain(
      "h-10",
    );
    expect(details?.closest("[data-holiday-details]")?.className).toContain(
      "overflow-hidden",
    );
    expect(details?.closest("[data-picker-footer]")).not.toBeNull();
    expect(desktopDetailsRegion.className).toContain("hidden");
    expect(desktopDetailsRegion.className).toContain("sm:block");
    expect(desktopDetailsRegion.className).toContain("col-start-2");
    expect(document.querySelector("[data-holiday-tooltip]")).toBeNull();
    expect(document.querySelector('[role="tooltip"]')).toBeNull();
  });

  it("keeps footer tracks and height stable between one and multiple titles", async () => {
    installHolidayFetch([
      holidayDay("2026-03-21", "official", ["One title"]),
      holidayDay("2026-03-22", "official", [
        "A much longer first title",
        "A second title",
        "A third title",
      ]),
    ]);
    openSinglePicker({
      cancelText: "Cancel",
      labels: { today: "Today" },
    });
    const oneTitleDay = await findCalendarDay("2026-03-21");
    const multipleTitleDay = await findCalendarDay("2026-03-22");
    const footerGrid = document.querySelector<HTMLElement>(
      "[data-picker-footer-grid]",
    )!;
    const mobileDetailsRow = document.querySelector<HTMLElement>(
      "[data-mobile-holiday-details-row]",
    )!;
    const details = mobileDetailsRow.querySelector<HTMLElement>(
      "[data-holiday-details]",
    )!;
    const desktopDetailsRegion = document.querySelector<HTMLElement>(
      "[data-desktop-holiday-details]",
    )!;
    const actionGroup = document.querySelector<HTMLElement>(
      "[data-picker-action-group]",
    )!;
    const todayAction = document.querySelector<HTMLElement>(
      "[data-picker-today-action]",
    )!;
    const stableGridClassName = footerGrid.className;
    const stableDetailsClassName = details.className;

    fireEvent.mouseEnter(oneTitleDay);
    expect(details.textContent).toBe("One title");

    fireEvent.mouseEnter(multipleTitleDay);
    expect(details.textContent).toBe(
      "A much longer first title • A second title • A third title",
    );
    expect(footerGrid.className).toBe(stableGridClassName);
    expect(details.className).toBe(stableDetailsClassName);
    expect(footerGrid.className).toContain("min-h-12");
    expect(footerGrid.className).toContain("min-w-0");
    expect(footerGrid.className).toContain(
      "grid-cols-[auto_1fr_auto]",
    );
    expect(details.className).toContain("h-10");
    expect(details.className).toContain("overflow-hidden");
    expect(actionGroup.className).toContain("col-start-1");
    expectNonWrappingActionGroup(actionGroup);
    expect(mobileDetailsRow.className).toContain("sm:hidden");
    expect(mobileDetailsRow.parentElement?.dataset.pickerFooter).toBe("true");
    expect(footerGrid.contains(mobileDetailsRow)).toBe(false);
    expect(
      footerGrid.querySelector("[data-mobile-footer-spacer]"),
    ).not.toBeNull();
    expect(desktopDetailsRegion.className).toContain("col-start-2");
    expect(desktopDetailsRegion.className).toContain("min-w-0");
    expect(desktopDetailsRegion.className).toContain("hidden");
    expect(desktopDetailsRegion.className).toContain("sm:block");
    expect(
      details.querySelector("[data-holiday-details-content]")?.className,
    ).toContain("line-clamp-2");
    expect(
      desktopDetailsRegion.querySelector("[data-holiday-details]")?.className,
    ).toContain("h-10");
    expect(todayAction.className).toContain("col-start-3");
    expect(screen.getByRole("button", { name: "Confirm" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Today" })).toBeTruthy();
  });

  it("uses hover, focus, and selected-title precedence without a floating element", async () => {
    setDesktopViewport(true);
    installHolidayFetch([
      holidayDay("2026-03-21", "official", ["Selected title"]),
      holidayDay("2026-03-22", "official", ["Focused title"]),
    ]);
    openSinglePicker();
    const selectedDay = await findCalendarDay("2026-03-21");
    const focusedDay = await findCalendarDay("2026-03-22");
    const details = document.querySelector<HTMLElement>(
      "[data-holiday-details]",
    )!;

    fireEvent.click(selectedDay);
    fireEvent.mouseLeave(selectedDay);
    selectedDay.blur();
    expect(details.textContent).toBe("Selected title");

    focusCalendarDay(focusedDay);
    expect(details.textContent).toBe("Focused title");

    fireEvent.mouseEnter(selectedDay);
    expect(details.textContent).toBe("Selected title");

    fireEvent.mouseLeave(selectedDay);
    expect(details.textContent).toBe("Focused title");

    fireEvent.blur(focusedDay);
    expect(details.textContent).toBe("Selected title");
    expect(document.querySelector("[data-holiday-tooltip]")).toBeNull();
  });

  it("marks an ordinary Friday without creating empty details content", async () => {
    installHolidayFetch([holidayDay("2026-03-27", "weekly")]);
    openSinglePicker({ value: "2026-03-27" });
    const day = await findCalendarDay("2026-03-27");

    fireEvent.mouseEnter(day);
    focusCalendarDay(day);

    expect(day.dataset.holidayKind).toBe("weekly");
    expect(day.querySelector("[data-holiday-marker]")).not.toBeNull();
    expect(document.querySelector("[data-holiday-details]")).not.toBeNull();
    expect(document.querySelector("[data-holiday-details-content]")).toBeNull();
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

    const mobileDetailsRow = document.querySelector<HTMLElement>(
      "[data-mobile-holiday-details-row]",
    )!;
    const footerGrid = document.querySelector<HTMLElement>(
      "[data-picker-footer-grid]",
    )!;

    expect(mobileDetailsRow.textContent).toBe("Nowruz");
    expect(mobileDetailsRow.className).toContain("sm:hidden");
    expect(footerGrid.contains(mobileDetailsRow)).toBe(false);
  });

  it("uses the same fixed details footer in the range picker and keeps actions functional", async () => {
    installHolidayFetch([
      holidayDay("2026-03-21", "official", ["Range start"]),
      holidayDay("2026-03-22", "official", ["Range end", "Second occasion"]),
    ]);
    const onChange = vi.fn();
    const rendered = render(
      <SharedDateRangePicker
        cancelText="Cancel range"
        confirmText="Confirm range"
        onChange={onChange}
        value={{ startDate: "2026-03-21", endDate: null }}
      />,
    );

    fireEvent.click(rendered.container.querySelector("button")!);
    const startDay = await findCalendarDay("2026-03-21");
    const endDay = await findCalendarDay("2026-03-22");
    const mobileDetailsRow = document.querySelector<HTMLElement>(
      "[data-mobile-holiday-details-row]",
    )!;
    const details = mobileDetailsRow.querySelector<HTMLElement>(
      "[data-holiday-details]",
    )!;
    const desktopDetailsRegion = document.querySelector<HTMLElement>(
      "[data-desktop-holiday-details]",
    )!;

    fireEvent.mouseEnter(startDay);
    expect(details.textContent).toBe("Range start");
    expect(details.closest("[data-picker-footer]")).not.toBeNull();

    focusCalendarDay(startDay);
    fireEvent.mouseLeave(startDay);
    expect(details.textContent).toBe("Range start");

    fireEvent.blur(startDay);
    focusCalendarDay(endDay);
    fireEvent.click(endDay);
    fireEvent.mouseLeave(endDay);
    fireEvent.blur(endDay);
    expect(details.textContent).toBe("Range end • Second occasion");
    expect(
      document.querySelector("[data-picker-footer-grid]")?.className,
    ).toContain(
      "grid-cols-[auto_1fr_auto]",
    );
    expect(
      document.querySelector("[data-picker-footer-grid]")?.className,
    ).toContain(
      "sm:grid-cols-[minmax(max-content,1fr)_minmax(220px,360px)_minmax(max-content,1fr)]",
    );
    expect(details.className).toContain("h-10");
    expect(details.className).toContain("overflow-hidden");
    expect(mobileDetailsRow.className).toContain("sm:hidden");
    expect(
      document
        .querySelector("[data-picker-footer-grid]")
        ?.contains(mobileDetailsRow),
    ).toBe(false);
    expect(desktopDetailsRegion.className).toContain("hidden");
    expect(desktopDetailsRegion.className).toContain("sm:block");
    expect(desktopDetailsRegion.className).toContain("col-start-2");
    expect(
      desktopDetailsRegion.querySelector("[data-holiday-details]")?.className,
    ).toContain("h-10");
    expect(
      details.querySelector("[data-holiday-details-content]")?.className,
    ).toContain("line-clamp-2");

    const actionGroup = document.querySelector<HTMLElement>(
      "[data-picker-action-group]",
    )!;
    expectNonWrappingActionGroup(actionGroup);
    expect(document.querySelector("[data-picker-today-action]")).not.toBeNull();

    expect(screen.getByRole("button", { name: "Cancel range" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Confirm range" }));

    expect(onChange).toHaveBeenCalledWith({
      startDate: "2026-03-21",
      endDate: "2026-03-22",
    });
    expect(document.querySelector("[data-holiday-tooltip]")).toBeNull();
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
