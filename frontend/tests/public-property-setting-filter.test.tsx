import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fetchPublicApi: vi.fn(),
  replace: vi.fn(),
}));

let searchParams = new URLSearchParams();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mocks.replace }),
  useSearchParams: () => searchParams,
}));

vi.mock("next/image", () => ({
  default: ({ alt, ...props }: React.ImgHTMLAttributes<HTMLImageElement>) => (
    <img alt={alt} {...props} />
  ),
}));

vi.mock("@/components/AccommodationSearchBox", () => ({
  AccommodationSearchBox: () => <div>جستجوی اقامتگاه</div>,
}));

vi.mock("@/components/promotions/PromotionCards", () => ({
  PromotionCards: () => null,
}));

vi.mock("@/lib/public-properties", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/public-properties")>();
  return { ...actual, fetchPublicApi: mocks.fetchPublicApi };
});

import PropertiesPage from "@/app/properties/page";

const settings = [
  { id: 1, name: "بافت تاریخی", slug: "historic-district" },
  { id: 2, name: "محدوده بازار", slug: "bazaar-area" },
];

describe("public PropertySetting search filter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    searchParams = new URLSearchParams();
    mocks.fetchPublicApi.mockImplementation((path: string) =>
      Promise.resolve(path === "/property-settings" ? settings : []),
    );
  });

  it("loads options from the catalog and omits an empty filter", async () => {
    render(<PropertiesPage />);

    expect(
      await screen.findByRole("group", { name: "بافت و موقعیت محیطی" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("checkbox", { name: "بافت تاریخی" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("checkbox", { name: "محدوده بازار" }),
    ).toBeTruthy();

    await waitFor(() => {
      expect(mocks.fetchPublicApi).toHaveBeenCalledWith("/property-settings");
      const propertyRequest = mocks.fetchPublicApi.mock.calls.find(
        ([path]) => typeof path === "string" && path.startsWith("/properties?"),
      )?.[0] as string;
      expect(propertyRequest).not.toContain("settingSlugs");
    });
  });

  it("sends selected slugs and restores checkbox state from the URL", async () => {
    searchParams = new URLSearchParams({
      q: "خانه",
      settingSlugs: "historic-district,bazaar-area",
    });
    render(<PropertiesPage />);

    const historic = await screen.findByRole("checkbox", {
      name: "بافت تاریخی",
    });
    const bazaar = screen.getByRole("checkbox", { name: "محدوده بازار" });
    expect((historic as HTMLInputElement).checked).toBe(true);
    expect((bazaar as HTMLInputElement).checked).toBe(true);

    await waitFor(() => {
      const propertyRequest = mocks.fetchPublicApi.mock.calls.find(
        ([path]) =>
          typeof path === "string" && path.includes("settingSlugs="),
      )?.[0] as string;
      expect(propertyRequest).toContain(
        "settingSlugs=historic-district%2Cbazaar-area",
      );
    });
  });

  it("updates the multi-select while preserving existing search state", async () => {
    searchParams = new URLSearchParams({
      q: "خانه",
      propertyType: "TraditionalHouse",
      settingSlugs: "historic-district",
    });
    render(<PropertiesPage />);

    fireEvent.click(
      await screen.findByRole("checkbox", { name: "محدوده بازار" }),
    );

    expect(mocks.replace).toHaveBeenCalledWith(
      "/properties?q=%D8%AE%D8%A7%D9%86%D9%87&propertyType=TraditionalHouse&settingSlugs=historic-district%2Cbazaar-area",
      { scroll: false },
    );
  });

  it("removes the parameter after the final selection is cleared", async () => {
    searchParams = new URLSearchParams({
      city: "کاشان",
      settingSlugs: "historic-district",
    });
    render(<PropertiesPage />);

    fireEvent.click(
      await screen.findByRole("checkbox", { name: "بافت تاریخی" }),
    );

    expect(mocks.replace).toHaveBeenCalledWith(
      "/properties?city=%DA%A9%D8%A7%D8%B4%D8%A7%D9%86",
      { scroll: false },
    );
  });
});
