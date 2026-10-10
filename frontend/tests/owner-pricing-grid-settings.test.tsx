import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  apiRequest: vi.fn(),
  currencyLabel: "تومان",
  push: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push }),
}));

vi.mock("@/lib/owner-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/owner-api")>();
  return { ...actual, apiRequest: mocks.apiRequest };
});

vi.mock("@/lib/currency", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/currency")>();
  return { ...actual, useSiteCurrencyLabel: () => mocks.currencyLabel };
});

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

vi.mock("@/components/CalendarRangeGridEditor", () => ({
  CalendarRangeGridEditor: ({
    pricingCurrencyLabel,
    pricingMaxValue,
    pricingMinValue,
  }: {
    pricingCurrencyLabel?: string;
    pricingMaxValue?: number;
    pricingMinValue?: number;
  }) => (
    <div
      data-currency={pricingCurrencyLabel}
      data-maximum={pricingMaxValue}
      data-minimum={pricingMinValue}
      data-testid="pricing-editor"
    />
  ),
  CalendarSelectionEditor: () => null,
}));

vi.mock("@/components/pricing/RoomPricingMatrixEditor", () => ({
  default: () => null,
}));

vi.mock("@/components/pricing/PricingBulkEditDialog", () => ({
  default: ({ pricingCurrencyLabel }: { pricingCurrencyLabel?: string }) => (
    <div data-currency={pricingCurrencyLabel} data-testid="bulk-pricing-dialog" />
  ),
}));

import { OwnerPricingGrid } from "@/components/owner/OwnerPricingGrid";

function installApiResponses(
  managementResult: Record<string, string> | Error,
  calendarDate?: string,
) {
  mocks.apiRequest.mockImplementation((path: string) => {
    if (path === "/site-settings/management") {
      return managementResult instanceof Error
        ? Promise.reject(managementResult)
        : Promise.resolve(managementResult);
    }
    if (path === "/owner/properties/51") {
      return Promise.resolve({
        id: 51,
        name: "اقامتگاه تست",
        childPrice: 100,
        extraGuestPrice: 100,
        hasSeparateForeignPricing: false,
      });
    }
    if (path === "/owner/properties/51/pricing/history") {
      return Promise.resolve([]);
    }
    if (path.startsWith("/owner/properties/51/pricing?")) {
      return Promise.resolve({
        propertyId: 51,
        startDate: "2026-09-01",
        endDate: "2026-09-30",
        roomTypes: [
          {
            roomTypeId: 7,
            name: "اتاق تست",
            days: calendarDate ? [{ date: calendarDate, basePrice: 3_000_000 }] : [],
          },
        ],
      });
    }
    if (path.startsWith("/owner/properties/51/inventory?")) {
      return Promise.resolve({
        propertyId: 51,
        roomTypes: [{
          roomTypeId: 7,
          name: "اتاق تست",
          totalInventory: 3,
          days: calendarDate ? [{ date: calendarDate, availableCount: 2, status: "OnRequest" }] : [],
        }],
      });
    }
    return Promise.reject(new Error(`Unexpected API request: ${path}`));
  });
}

describe("OwnerPricingGrid operational settings", () => {
  beforeEach(() => {
    mocks.apiRequest.mockReset();
    mocks.currencyLabel = "تومان";
    mocks.push.mockReset();
  });

  it("gets price bounds from management and currency from the canonical helper", async () => {
    installApiResponses({
      "pricing.minPrice": "125000",
      "pricing.maxPrice": "9750000",
    });
    mocks.currencyLabel = "ریال آزمایشی";
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    render(<OwnerPricingGrid propertyId={51} />);

    const editor = await screen.findByTestId("pricing-editor");
    await waitFor(() =>
      expect(editor.getAttribute("data-currency")).toBe("ریال آزمایشی"),
    );
    expect(screen.getByText("ریال آزمایشی")).toBeTruthy();
    expect(screen.getByTestId("bulk-pricing-dialog").getAttribute("data-currency"))
      .toBe("ریال آزمایشی");
    expect(editor.getAttribute("data-minimum")).toBe("125000");
    expect(editor.getAttribute("data-maximum")).toBe("9750000");
    expect(mocks.apiRequest).toHaveBeenCalledWith(
      "/site-settings/management",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps price-bound fallbacks independently from the configured currency", async () => {
    installApiResponses(new Error("forbidden"));
    mocks.currencyLabel = "ریال آزمایشی";

    render(<OwnerPricingGrid context="admin" propertyId={51} />);

    const editor = await screen.findByTestId("pricing-editor");
    await waitFor(() =>
      expect(editor.getAttribute("data-currency")).toBe("ریال آزمایشی"),
    );
    expect(editor.getAttribute("data-minimum")).toBe("0");
    expect(editor.getAttribute("data-maximum")).toBe("1000000000");
    expect(
      mocks.apiRequest.mock.calls.some(
        ([, init]) => init?.method === "POST" || init?.method === "PUT",
      ),
    ).toBe(false);
  });

  it("uses the canonical currency fallback without changing management bounds", async () => {
    installApiResponses({
      "pricing.minPrice": "125000",
      "pricing.maxPrice": "9750000",
    });

    render(<OwnerPricingGrid propertyId={51} />);

    const editor = await screen.findByTestId("pricing-editor");
    await waitFor(() =>
      expect(editor.getAttribute("data-currency")).toBe("تومان"),
    );
    expect(editor.getAttribute("data-minimum")).toBe("125000");
    expect(editor.getAttribute("data-maximum")).toBe("9750000");
  });

  it("keeps calendar switching, month navigation and management day selection", async () => {
    const today = new Date();
    const calendarDate = [today.getFullYear(), String(today.getMonth() + 1).padStart(2, "0"), String(today.getDate()).padStart(2, "0")].join("-");
    installApiResponses({ "pricing.minPrice": "0", "pricing.maxPrice": "10000000" }, calendarDate);
    render(<OwnerPricingGrid propertyId={51} />);

    expect(await screen.findByRole("button", { name: "نمایش پیش‌فرض" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "نمایش تقویم" }));
    expect(screen.getByRole("button", { name: "نمایش تقویم" }).getAttribute("aria-pressed")).toBe("true");
    expect(await screen.findByText("تقویم آزمایشی نرخ و موجودی")).toBeTruthy();
    await waitFor(() => expect(mocks.apiRequest.mock.calls.some(([path]) => path.startsWith("/owner/properties/51/inventory?"))).toBe(true));
    expect(screen.getByText("شنبه")).toBeTruthy();
    expect(screen.getByText("جمعه")).toBeTruthy();
    expect(screen.getByText("۳٬۰۰۰")).toBeTruthy();
    expect(screen.getByText("۲/۳")).toBeTruthy();

    const day = screen.getByRole("button", { name: /اتاق تست،.*استعلامی.*۳٬۰۰۰٬۰۰۰ تومان/ });
    expect(day.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(day);
    expect(day.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText("۱ روز انتخاب شده")).toBeTruthy();
    expect(screen.getByText("روز پایان بازه را انتخاب کنید.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "تکی" }));
    expect(screen.queryByText("روز پایان بازه را انتخاب کنید.")).toBeNull();

    const callsBeforeMonthChange = mocks.apiRequest.mock.calls.filter(([path]) => path.startsWith("/owner/properties/51/pricing?")).length;
    fireEvent.click(screen.getByRole("button", { name: "ماه بعد" }));
    await waitFor(() => expect(mocks.apiRequest.mock.calls.filter(([path]) => path.startsWith("/owner/properties/51/pricing?")).length).toBeGreaterThan(callsBeforeMonthChange));
    fireEvent.click(screen.getByRole("button", { name: "ماه قبل" }));
    await waitFor(() => expect(mocks.apiRequest.mock.calls.filter(([path]) => path.startsWith("/owner/properties/51/pricing?")).length).toBeGreaterThan(callsBeforeMonthChange + 1));
    fireEvent.click(screen.getByRole("button", { name: "نمایش جدول" }));
    expect(screen.getByRole("button", { name: "نمایش جدول" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "نمایش پیش‌فرض" }));
    expect(screen.getByRole("button", { name: "نمایش پیش‌فرض" }).getAttribute("aria-pressed")).toBe("true");
  });
});
