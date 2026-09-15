import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  apiRequest: vi.fn(),
  push: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push }),
}));

vi.mock("@/lib/owner-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/owner-api")>();
  return { ...actual, apiRequest: mocks.apiRequest };
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
  default: () => null,
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
    mocks.push.mockReset();
  });

  it("gets price bounds from management while preserving the public currency source", async () => {
    installApiResponses({
      "pricing.minPrice": "125000",
      "pricing.maxPrice": "9750000",
    });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        "pricing.currencyLabel": "تومان تست",
        "pricing.minPrice": "999",
        "pricing.maxPrice": "999",
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<OwnerPricingGrid propertyId={51} />);

    const editor = await screen.findByTestId("pricing-editor");
    await waitFor(() =>
      expect(editor.getAttribute("data-currency")).toBe("تومان تست"),
    );
    expect(editor.getAttribute("data-minimum")).toBe("125000");
    expect(editor.getAttribute("data-maximum")).toBe("9750000");
    expect(mocks.apiRequest).toHaveBeenCalledWith(
      "/site-settings/management",
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/backend/site-settings/public",
    );
  });

  it("keeps price-bound fallbacks when management settings cannot be loaded", async () => {
    installApiResponses(new Error("forbidden"));
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ "pricing.currencyLabel": "تومان" }),
      }),
    );

    render(<OwnerPricingGrid context="admin" propertyId={51} />);

    const editor = await screen.findByTestId("pricing-editor");
    await waitFor(() =>
      expect(editor.getAttribute("data-currency")).toBe("تومان"),
    );
    expect(editor.getAttribute("data-minimum")).toBe("0");
    expect(editor.getAttribute("data-maximum")).toBe("1000000000");
    expect(
      mocks.apiRequest.mock.calls.some(
        ([, init]) => init?.method === "POST" || init?.method === "PUT",
      ),
    ).toBe(false);
  });
});
