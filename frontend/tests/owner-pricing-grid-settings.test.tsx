import { render, screen, waitFor } from "@testing-library/react";
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
            days: [],
          },
        ],
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
});
