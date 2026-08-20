import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DevelopmentDatePickerNavigation,
  shouldShowDevelopmentNavigation,
} from "@/components/Header";
import { KoochCompactDateRangePicker } from "@/components/KoochCompactDateRangePicker";
import {
  SharedDateRangePicker,
  type SharedDateRangeValue,
} from "@/components/SharedDateRangePicker";

const committedRange: SharedDateRangeValue = {
  startDate: "2026-03-21",
  endDate: "2026-03-23",
};

function findDay(date: string) {
  const day = document.querySelector<HTMLButtonElement>(
    `[data-calendar-date="${date}"]`,
  );
  expect(day).not.toBeNull();
  return day!;
}

function ControlledPicker({
  fieldSize = "standard",
  daySpacing,
  onCommit = vi.fn(),
}: {
  fieldSize?: "standard" | "compact";
  daySpacing?: "compact" | "normal" | "comfortable";
  onCommit?: (value: SharedDateRangeValue) => void;
}) {
  const [value, setValue] = useState(committedRange);

  return (
    <KoochCompactDateRangePicker
      daySpacing={daySpacing}
      fieldSize={fieldSize}
      onChange={(nextValue) => {
        onCommit(nextValue);
        setValue(nextValue);
      }}
      value={value}
    />
  );
}

describe("KoochCompactDateRangePicker", () => {
  beforeEach(() => {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("renders one combined empty control with both placeholders", () => {
    render(
      <KoochCompactDateRangePicker
        onChange={vi.fn()}
        value={{ startDate: null, endDate: null }}
      />,
    );

    expect(screen.getAllByRole("button")).toHaveLength(1);
    expect(screen.getByText("تاریخ ورود")).toBeTruthy();
    expect(screen.getByText("تاریخ خروج")).toBeTruthy();
    expect(document.querySelector("[data-date-divider]")).not.toBeNull();
    expect(document.querySelector("[data-date-weekday]")).toBeNull();
  });

  it.each(["standard", "compact"] as const)(
    "keeps date above weekday in the %s field",
    (fieldSize) => {
      render(
        <KoochCompactDateRangePicker
          fieldSize={fieldSize}
          onChange={vi.fn()}
          value={committedRange}
        />,
      );

      const field = document.querySelector<HTMLElement>(
        "[data-combined-date-field]",
      )!;
      const startDate = field.querySelector<HTMLElement>(
        '[data-date-primary="start"]',
      )!;
      const startWeekday = field.querySelector<HTMLElement>(
        '[data-date-weekday="start"]',
      )!;
      const endDate = field.querySelector<HTMLElement>(
        '[data-date-primary="end"]',
      )!;
      const endWeekday = field.querySelector<HTMLElement>(
        '[data-date-weekday="end"]',
      )!;

      expect(field.dataset.fieldSize).toBe(fieldSize);
      expect(startDate.textContent).toMatch(/[۰-۹]/);
      expect(endDate.textContent).toMatch(/[۰-۹]/);
      expect(startWeekday.textContent).not.toBe("");
      expect(endWeekday.textContent).not.toBe("");
      expect(
        startDate.compareDocumentPosition(startWeekday) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      expect(
        endDate.compareDocumentPosition(endWeekday) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    },
  );

  it("uses real compact spacing instead of scaling the standard field", () => {
    const first = render(
      <KoochCompactDateRangePicker
        fieldSize="standard"
        onChange={vi.fn()}
        value={committedRange}
      />,
    );
    const standard = first.container.querySelector<HTMLElement>(
      "[data-combined-date-field]",
    )!;
    expect(standard.className).toContain("min-h-16");
    expect(standard.className).not.toContain("scale-");
    first.unmount();

    render(
      <KoochCompactDateRangePicker
        fieldSize="compact"
        onChange={vi.fn()}
        value={committedRange}
      />,
    );
    const compact = document.querySelector<HTMLElement>(
      "[data-combined-date-field]",
    )!;
    expect(compact.className).toContain("min-h-12");
    expect(compact.className).not.toContain("scale-");
  });

  it("opens with pointer, Enter, and Space", () => {
    const rendered = render(<ControlledPicker />);
    const trigger = screen.getByRole("button", { name: /تاریخ ورود/ });

    fireEvent.click(trigger);
    expect(screen.getByRole("dialog", { name: "انتخاب تاریخ اقامت" })).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });

    fireEvent.keyDown(trigger, { key: "Enter" });
    expect(screen.getByRole("dialog", { name: "انتخاب تاریخ اقامت" })).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });

    fireEvent.keyDown(trigger, { key: " " });
    expect(screen.getByRole("dialog", { name: "انتخاب تاریخ اقامت" })).toBeTruthy();
    rendered.unmount();
  });

  it("commits exactly once after the second date and closes", () => {
    const onCommit = vi.fn();
    render(<ControlledPicker onCommit={onCommit} />);
    fireEvent.click(screen.getByRole("button", { name: /تاریخ ورود/ }));

    fireEvent.click(findDay("2026-03-24"));
    expect(onCommit).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "انتخاب تاریخ اقامت" })).toBeTruthy();

    fireEvent.click(findDay("2026-03-26"));
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith({
      startDate: "2026-03-24",
      endDate: "2026-03-26",
    });
    expect(screen.queryByRole("dialog", { name: "انتخاب تاریخ اقامت" })).toBeNull();
  });

  it("discards an incomplete draft on outside click", () => {
    const onCommit = vi.fn();
    render(<ControlledPicker onCommit={onCommit} />);
    fireEvent.click(screen.getByRole("button", { name: /تاریخ ورود/ }));
    fireEvent.click(findDay("2026-03-24"));

    fireEvent.pointerDown(document.body);

    expect(onCommit).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog", { name: "انتخاب تاریخ اقامت" })).toBeNull();
    expect(document.querySelector('[data-date-primary="start"]')?.textContent)
      .toContain("۱۴۰۵");
  });

  it("discards an incomplete draft on Escape and restores trigger focus", async () => {
    const onCommit = vi.fn();
    render(<ControlledPicker onCommit={onCommit} />);
    const trigger = screen.getByRole("button", { name: /تاریخ ورود/ });
    fireEvent.click(trigger);
    fireEvent.click(findDay("2026-03-24"));

    fireEvent.keyDown(document, { key: "Escape" });

    expect(onCommit).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog", { name: "انتخاب تاریخ اقامت" })).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it("omits footer actions and occasion loading from the compact picker", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<ControlledPicker daySpacing="compact" />);
    fireEvent.click(screen.getByRole("button", { name: /تاریخ ورود/ }));

    expect(document.querySelector("[data-picker-footer]")).toBeNull();
    expect(screen.queryByRole("button", { name: "تایید" })).toBeNull();
    expect(screen.queryByRole("button", { name: "انصراف" })).toBeNull();
    expect(document.querySelector("[data-holiday-details]")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(document.querySelector("[data-calendar-day-spacing]")?.getAttribute(
      "data-calendar-day-spacing",
    )).toBe("compact");
  });

  it("preserves default spacing, footer actions, and confirmation in the regular picker", () => {
    render(
      <SharedDateRangePicker
        onChange={vi.fn()}
        value={committedRange}
      />,
    );
    fireEvent.click(screen.getAllByRole("button")[0]);

    expect(document.querySelector("[data-calendar-day-spacing]")?.getAttribute(
      "data-calendar-day-spacing",
    )).toBe("normal");
    expect(document.querySelector("[data-picker-footer]")).not.toBeNull();
    expect(screen.getByRole("button", { name: "تایید" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "انصراف" })).toBeTruthy();
  });

  it("limits the test navigation to development", () => {
    expect(shouldShowDevelopmentNavigation("development")).toBe(true);
    expect(shouldShowDevelopmentNavigation("production")).toBe(false);
    expect(shouldShowDevelopmentNavigation("test")).toBe(false);

    const development = render(
      <DevelopmentDatePickerNavigation environment="development" />,
    );
    expect(screen.getByRole("link", { name: "تست تقویم" }).getAttribute("href"))
      .toBe("/dev/date-picker-test");
    development.unmount();

    render(<DevelopmentDatePickerNavigation environment="production" />);
    expect(screen.queryByRole("link", { name: "تست تقویم" })).toBeNull();
  });
});
