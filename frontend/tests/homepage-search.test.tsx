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
  it.each([
    ["2030-08-20", null], [null, "2030-08-22"],
    ["2030-08-20", "2030-08-20"], ["2030-08-22", "2030-08-20"],
    ["2030-02-30", "2030-03-02"], ["", ""],
  ])("preserves invalid dates %s / %s for correction and blocks submission", (checkIn, checkOut) => {
    const onSearch = vi.fn();
    render(<AccommodationSearchBox initialValues={{ checkIn, checkOut }} onSearch={onSearch} redirectToResults />);
    const dateControl = screen.getByRole("button", { name: /تاریخ ورود/ });
    const originalDates = dateControl.getAttribute("aria-label");
    fireEvent.click(screen.getByRole("button", { name: "جستجوی اقامتگاه" }));
    expect(screen.getByRole("alert").textContent).toMatch(/تاریخ/);
    expect(onSearch).not.toHaveBeenCalled();
    expect(mocks.push).not.toHaveBeenCalled();
    expect(dateControl.getAttribute("aria-label")).toBe(originalDates);
  });

  it("allows undated search without adding date query parameters", () => {
    const onSearch = vi.fn();
    render(<AccommodationSearchBox onSearch={onSearch} redirectToResults />);
    fireEvent.click(screen.getByRole("button", { name: "جستجوی اقامتگاه" }));
    expect(onSearch).toHaveBeenCalledWith(expect.objectContaining({ checkIn: null, checkOut: null }));
    expect(mocks.push).toHaveBeenCalledWith("/properties?rooms=1&adults=2&children=0");
  });
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

  it("keeps destination, dates, guests and query submission in the compact results band", () => {
    render(
      <AccommodationSearchBox
        initialValues={initialValues}
        redirectToResults
        variant="band"
      />,
    );

    const form = screen.getByRole("button", { name: "جستجوی اقامتگاه" }).closest("form");
    expect(form?.className).not.toContain("rounded-xl");
    expect(form?.firstElementChild?.className).toContain("grid-cols-2");
    expect(form?.firstElementChild?.className).toContain("xl:grid-cols-");
    expect(screen.getByRole("textbox", { name: "مقصد" })).toHaveProperty("value", "کاشان");
    expect(document.querySelector("[data-combined-date-field]")).not.toBeNull();
    expect(document.querySelector('[style*="/svgs/users-3.svg"]')).not.toBeNull();
    expect(screen.getByRole("button", { name: "جستجوی اقامتگاه" }).className).toContain("h-12");

    fireEvent.click(screen.getByRole("button", { name: "جستجوی اقامتگاه" }));
    expect(mocks.push).toHaveBeenCalledOnce();
    const query = new URL(String(mocks.push.mock.calls[0][0]), "http://localhost").searchParams;
    expect(query.get("q")).toBe("کاشان");
    expect(query.get("checkIn")).toBe("2030-08-20");
    expect(query.get("checkOut")).toBe("2030-08-22");
    expect(query.get("rooms")).toBe("2");
    expect(query.get("adults")).toBe("3");
    expect(query.get("children")).toBe("1");
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
