import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { PropertyCompletionResponse } from "@/lib/owner-api";
import { PropertyCompletionCard } from "@/components/property/PropertyCompletionCard";

const completion = (
  warnings: string[] = [],
): PropertyCompletionResponse => ({
  propertyId: 17,
  completionPercentage: 100,
  healthStatus: "Ready",
  sections: [],
  warnings,
  completedSections: [],
  missingSections: [],
  canActivate: true,
});

describe("PropertyCompletionCard warnings", () => {
  it("shows no compact indicator when there are no warnings", () => {
    render(<PropertyCompletionCard compact completion={completion()} />);

    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryByText("هشدار")).toBeNull();
  });

  it("shows a Persian one-warning count without the warning text inline", () => {
    const warning = "در ۶۰ روز آینده در حال حاضر اقامت قابل رزروی باقی نمانده است.";
    render(<PropertyCompletionCard compact completion={completion([warning])} />);

    const indicator = screen.getByRole("status", {
      name: "۱ هشدار برای این اقامتگاه",
    });
    expect(indicator.textContent).toContain("۱ هشدار");
    expect(screen.queryByText(warning)).toBeNull();
    expect(indicator.querySelector('[aria-hidden="true"]')).toBeTruthy();
  });

  it("shows the Persian count for multiple warnings and stays non-interactive", () => {
    render(
      <PropertyCompletionCard
        compact
        completion={completion(["هشدار اول", "هشدار دوم", "هشدار سوم"])}
      />,
    );

    expect(
      screen.getByRole("status", { name: "۳ هشدار برای این اقامتگاه" })
        .textContent,
    ).toContain("۳ هشدار");
    expect(screen.queryByRole("button", { name: /هشدار/ })).toBeNull();
    expect(screen.queryByText("هشدار اول")).toBeNull();
  });

  it("keeps full mode warning text unchanged", () => {
    const warning = "در ۶۰ روز آینده در حال حاضر اقامت قابل رزروی باقی نمانده است.";
    render(<PropertyCompletionCard completion={completion([warning])} />);

    expect(screen.getByText(warning)).toBeTruthy();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("keeps a complete, activatable property complete when it has warnings", () => {
    const { container } = render(
      <PropertyCompletionCard compact completion={completion(["هشدار عملیاتی"])} />,
    );

    expect(screen.getByText("100% تکمیل شده")).toBeTruthy();
    expect(screen.getByText("آماده")).toBeTruthy();
    expect(screen.getByRole("status", { name: "۱ هشدار برای این اقامتگاه" }))
      .toBeTruthy();
    expect(
      container.querySelector('[style*="width: 100%"]'),
    ).toBeTruthy();
    expect(screen.queryByText("ناقص")).toBeNull();
  });
});
