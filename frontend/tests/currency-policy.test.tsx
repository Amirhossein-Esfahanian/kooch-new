import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { formatCurrency, refreshSiteCurrencyLabel, useSiteCurrencyLabel } from "@/lib/currency";

const settings = vi.hoisted(() => ({ label: "تومان" }));
vi.mock("@/lib/site-settings", async original => ({
  ...await original<typeof import("@/lib/site-settings")>(),
  fetchPublicSiteSettings: vi.fn(async () => ({ "pricing.currencyLabel": settings.label })),
}));

function Amount({ snapshot, testId }: { snapshot?: string | null; testId: string }) {
  const currencyLabel = useSiteCurrencyLabel(snapshot);
  return <span data-testid={testId}>{formatCurrency(5_000_000, { currencyLabel })}</span>;
}

describe("single configured display title with immutable booking metadata", () => {
  beforeEach(async () => {
    settings.label = "تومان";
    await refreshSiteCurrencyLabel();
  });

  it("changes current price titles without relabeling saved reservations or converting amounts", async () => {
    render(<><Amount testId="new-price" /><Amount testId="saved" snapshot="تومان" /></>);
    expect(screen.getByTestId("new-price").textContent).toBe("۵٬۰۰۰٬۰۰۰ تومان");
    settings.label = "عنوان جدید";
    await act(() => refreshSiteCurrencyLabel());
    expect(screen.getByTestId("new-price").textContent).toBe("۵٬۰۰۰٬۰۰۰ عنوان جدید");
    expect(screen.getByTestId("saved").textContent).toBe("۵٬۰۰۰٬۰۰۰ تومان");
    expect(formatCurrency(5_000_000)).toBe("۵٬۰۰۰٬۰۰۰ عنوان جدید");
    expect(formatCurrency(5_000_000, { showCurrency: false })).toBe("۵٬۰۰۰٬۰۰۰");
  });

  it("uses the current setting for test rows without a snapshot, preserving zero and unknown", () => {
    render(<Amount testId="legacy" snapshot="" />);
    expect(screen.getByTestId("legacy").textContent).toBe("۵٬۰۰۰٬۰۰۰ تومان");
    expect(formatCurrency(0)).toBe("۰ تومان");
    expect(formatCurrency(null)).toBe("-");
  });
});
