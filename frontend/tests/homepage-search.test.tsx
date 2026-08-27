import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AccommodationSearchBox,
  type AccommodationSearchValues,
} from "@/components/AccommodationSearchBox";

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push }),
}));

const initialValues: Partial<AccommodationSearchValues> = {
  q: "کاشان",
  checkIn: "2030-08-20",
  checkOut: "2030-08-22",
  rooms: 2,
  adults: 3,
  children: 1,
  childAges: [7],
};

function findDay(date: string) {
  const day = document.querySelector<HTMLButtonElement>(
    `[data-calendar-date="${date}"]`,
  );
  expect(day).not.toBeNull();
  return day!;
}

describe("homepage accommodation search", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            from: "2030-01-01",
            to: "2030-12-31",
            isRangeFullyCovered: true,
            days: [],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      ),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("uses one standard compact date-range field and the shared guest icon", () => {
    render(
      <AccommodationSearchBox
        initialValues={initialValues}
        variant="hero"
      />,
    );

    const dateFields = document.querySelectorAll("[data-combined-date-field]");
    expect(dateFields).toHaveLength(1);
    expect((dateFields[0] as HTMLElement).dataset.fieldSize).toBe("standard");
    expect(dateFields[0].classList.contains("kooch-form-control")).toBe(true);
    expect(
      document
        .querySelector("input[aria-label]")
        ?.classList.contains("kooch-form-control"),
    ).toBe(true);
    expect(
      document
        .querySelector('button[aria-expanded="false"]')
        ?.classList.contains("kooch-form-control"),
    ).toBe(true);
    expect(document.querySelector('[style*="/svgs/users-3.svg"]')).not.toBeNull();
    expect(screen.getByRole("button", { name: "جستجوی اقامتگاه" }).className)
      .toContain("h-16");
  });

  it("preserves existing dates and unchanged search submission semantics", () => {
    const onSearch = vi.fn();
    render(
      <AccommodationSearchBox
        initialValues={initialValues}
        onSearch={onSearch}
        variant="hero"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "جستجوی اقامتگاه" }));

    expect(onSearch).toHaveBeenCalledWith(
      expect.objectContaining({
        q: "کاشان",
        checkIn: "2030-08-20",
        checkOut: "2030-08-22",
        rooms: 2,
        adults: 3,
        children: 1,
        childAges: [7],
      }),
    );
  });

  it("commits a completed range to the existing search state", () => {
    const onSearch = vi.fn();
    render(
      <AccommodationSearchBox
        initialValues={initialValues}
        onSearch={onSearch}
        variant="hero"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /تاریخ ورود/ }));
    fireEvent.click(findDay("2030-08-24"));
    fireEvent.click(findDay("2030-08-26"));
    fireEvent.click(screen.getByRole("button", { name: "جستجوی اقامتگاه" }));

    expect(onSearch).toHaveBeenCalledWith(
      expect.objectContaining({
        checkIn: "2030-08-24",
        checkOut: "2030-08-26",
      }),
    );
  });

  it("discards an incomplete draft without mutating committed search dates", () => {
    const onSearch = vi.fn();
    render(
      <AccommodationSearchBox
        initialValues={initialValues}
        onSearch={onSearch}
        variant="hero"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /تاریخ ورود/ }));
    fireEvent.click(findDay("2030-08-24"));
    fireEvent.pointerDown(document.body);
    fireEvent.click(screen.getByRole("button", { name: "جستجوی اقامتگاه" }));

    expect(onSearch).toHaveBeenCalledWith(
      expect.objectContaining({
        checkIn: "2030-08-20",
        checkOut: "2030-08-22",
      }),
    );
  });
});
