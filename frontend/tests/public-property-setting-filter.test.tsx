import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  currencyLabel: "تومان",
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

vi.mock("@/lib/currency", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/currency")>();
  return { ...actual, useSiteCurrencyLabel: () => mocks.currencyLabel };
});

vi.mock("@/lib/public-properties", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/public-properties")>();
  return { ...actual, fetchPublicApi: mocks.fetchPublicApi };
});

import PropertiesPage from "@/app/properties/page";

const settings = [
  { id: 1, name: "بافت تاریخی", slug: "historic-district" },
  { id: 2, name: "محدوده بازار", slug: "bazaar-area" },
];

const resultProperty = {
  id: 1,
  name: "خانه آزمون",
  slug: "test-house",
  city: "کاشان",
  address: "نشانی آزمون",
  description: "اقامتگاه آزمون",
  shortDescription: "اقامتگاه آزمون",
  coverImageUrl: null,
  startingPrice: 1_250_000,
  propertyType: "TraditionalHouse",
  roomTypes: [],
  matchingRoomTypesCount: 1,
  matchingRoomTypes: [],
  guestFitStatus: "Fits",
  availabilitySummary: "Available",
  availabilityStatusSummary: "Available",
  promotions: [],
};

describe("public PropertySetting search filter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.currencyLabel = "تومان";
    searchParams = new URLSearchParams();
    mocks.fetchPublicApi.mockImplementation((path: string) =>
      Promise.resolve(path === "/property-settings" ? settings : []),
    );
  });

  it("keeps result filters and cards below the full-width search band", async () => {
    mocks.fetchPublicApi.mockImplementation((path: string) =>
      Promise.resolve(path === "/property-settings" ? settings : [resultProperty]),
    );
    render(<PropertiesPage />);

    const band = screen.getByTestId("results-search-bar");
    expect(band.className).toContain("bg-[var(--property-search-background)]");
    expect(band.className).toContain("top-[var(--header-height)]");
    expect(band.className).not.toContain("rounded-xl");
    const filter = await screen.findByRole("group", { name: "بافت و موقعیت محیطی" });
    expect(band.contains(filter)).toBe(false);
    expect(await screen.findByText("خانه آزمون")).toBeTruthy();
    expect(band.contains(screen.getByText("خانه آزمون"))).toBe(false);
  });

  it("uses the configured currency label in property result prices", async () => {
    mocks.currencyLabel = "ریال آزمایشی";
    mocks.fetchPublicApi.mockImplementation((path: string) =>
      Promise.resolve(path === "/property-settings" ? settings : [resultProperty]),
    );

    render(<PropertiesPage />);

    expect(
      await screen.findByText("۱٬۲۵۰٬۰۰۰ ریال آزمایشی / شب"),
    ).toBeTruthy();
  });

  it("shows zero as a real price and null as an unknown price", async () => {
    mocks.fetchPublicApi.mockImplementation((path: string) =>
      Promise.resolve(path === "/property-settings" ? settings : [
        { ...resultProperty, id: 2, name: "اقامت رایگان", startingPrice: 0 },
        { ...resultProperty, id: 3, name: "اقامت نامشخص", startingPrice: null },
      ]),
    );
    render(<PropertiesPage />);

    expect(await screen.findByText("۰ تومان / شب")).toBeTruthy();
    expect(screen.getByText("قیمت پس از تعیین در تقویم")).toBeTruthy();
    expect(screen.getByText("اقامت نامشخص")).toBeTruthy();
  });

  it.each([
    ["maxPrice", "2000000", ["اقامت رایگان", "اقامت میانی"]],
    ["minPrice", "1", ["اقامت میانی", "اقامت گران"]],
    ["minPrice", "1500000", ["اقامت میانی", "اقامت گران"]],
  ])("filters the authoritative price with %s=%s", async (key, value, expected) => {
    searchParams = new URLSearchParams({ [key]: value });
    mocks.fetchPublicApi.mockImplementation((path: string) =>
      Promise.resolve(path === "/property-settings" ? settings : [
        { ...resultProperty, id: 2, name: "اقامت رایگان", startingPrice: 0 },
        { ...resultProperty, id: 3, name: "اقامت نامشخص", startingPrice: null },
        { ...resultProperty, id: 4, name: "اقامت میانی", startingPrice: 1_800_000 },
        { ...resultProperty, id: 5, name: "اقامت گران", startingPrice: 2_500_000 },
      ]),
    );
    render(<PropertiesPage />);

    expect(await screen.findByText(expected[0])).toBeTruthy();
    for (const name of expected) expect(screen.getByText(name)).toBeTruthy();
    expect(screen.queryByText("اقامت نامشخص")).toBeNull();
    expect(screen.queryByText("اقامت رایگان") !== null).toBe(expected.includes("اقامت رایگان"));
    expect(screen.queryByText("اقامت گران") !== null).toBe(expected.includes("اقامت گران"));
  });

  it("keeps the compact label for one room and names multiple requested rooms for dated results", async () => {
    searchParams = new URLSearchParams({ checkIn: "2026-10-14", checkOut: "2026-10-16", rooms: "2" });
    mocks.fetchPublicApi.mockImplementation((path: string) =>
      Promise.resolve(path === "/property-settings" ? settings : [resultProperty]),
    );
    render(<PropertiesPage />);

    expect(await screen.findByText("قیمت از برای ۲ اتاق")).toBeTruthy();
    expect(screen.getByText("۱٬۲۵۰٬۰۰۰ تومان / شب")).toBeTruthy();
  });

  it.each([
    { checkIn: "2026-10-14", checkOut: "2026-10-16", rooms: "1" },
    { rooms: "2" },
  ])("keeps the ordinary label without a dated multi-room context", async (params) => {
    searchParams = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value) searchParams.set(key, value);
    });
    mocks.fetchPublicApi.mockImplementation((path: string) =>
      Promise.resolve(path === "/property-settings" ? settings : [resultProperty]),
    );
    render(<PropertiesPage />);

    expect(await screen.findByText("خانه آزمون")).toBeTruthy();
    expect(screen.getByText("قیمت از")).toBeTruthy();
    expect(screen.queryByText(/قیمت از برای/)).toBeNull();
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
