import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  fetchProperty: vi.fn(),
  fetchOptions: vi.fn(),
}));

const searchParams = new URLSearchParams({
  checkIn: "2030-08-10",
  checkOut: "2030-08-12",
  adults: "2",
  rooms: "1",
});

vi.mock("next/navigation", () => ({
  useParams: () => ({ slug: "kashan-house" }),
  usePathname: () => "/properties/kashan-house",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => searchParams,
}));
vi.mock("@/components/auth/AuthSessionProvider", () => ({
  useAuthSession: () => ({ authenticated: false, loading: false }),
}));
vi.mock("@/components/KoochDatePicker", () => ({
  KoochDatePicker: () => <div data-testid="booking-date-picker">انتخاب تاریخ اقامت</div>,
}));
vi.mock("@/components/GuestSelector", () => ({
  GuestSelector: () => <div data-testid="booking-guest-selector">انتخاب مهمان و تعداد اتاق</div>,
}));
vi.mock("@/lib/public-properties", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/public-properties")>();
  return { ...actual, fetchPublicApi: api.fetchProperty };
});
vi.mock("@/lib/booking-sessions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/booking-sessions")>();
  return { ...actual, fetchBookingOptions: api.fetchOptions };
});

import PublicPropertyPage from "@/app/properties/[slug]/page";

const property = {
  id: 1,
  name: "خانه کاشان",
  englishName: "Kashan House",
  slug: "kashan-house",
  seoTitle: null,
  seoDescription: null,
  city: "کاشان",
  country: "IR",
  address: "خیابان علوی",
  description: "اقامتگاهی سنتی",
  shortDescription: "خانه سنتی",
  coverImageUrl: null,
  status: "Approved" as const,
  propertyType: "TraditionalHouse",
  inventoryMode: "TypeBasedInventory" as const,
  checkInTime: "14:00:00",
  checkOutTime: "12:00:00",
  breakfastOption: "Included" as const,
  breakfastPrice: null,
  latitude: null,
  longitude: null,
  hasElevator: false,
  isWheelchairAccessible: null,
  hasGroundFloorRoom: null,
  hasAccessibleBathroom: null,
  isInstantBooking: true,
  startingPrice: 2_000_000,
  matchingRoomTypesCount: 1,
  matchingRoomTypes: [],
  guestFitStatus: "Fits",
  availabilitySummary: "Available",
  availabilityStatusSummary: "Available" as const,
  promotions: [],
  freeChildAgeLimit: null,
  maxFreeChildren: null,
  images: [],
  descriptionSections: [],
  commonAreas: [],
  amenities: [],
  nearbyPlaces: [],
  views: [],
  roomTypes: [],
};

const availableOptions = {
  propertyId: 1,
  propertyName: property.name,
  propertySlug: property.slug,
  checkInDate: "2030-08-10",
  checkOutDate: "2030-08-12",
  adults: 2,
  children: 0,
  childAges: [],
  roomTypes: [
    {
      roomTypeId: 10,
      name: "اتاق شاه‌نشین",
      englishName: null,
      inventoryMode: "TypeBasedInventory" as const,
      availableCount: 2,
      bookingMode: "Instant" as const,
      maxAdults: 2,
      maxChildren: 0,
      allowExtraGuest: false,
      maxExtraGuests: 0,
      nightsCount: 2,
      finalAmount: 4_000_000,
      currency: "IRR",
      rooms: [],
    },
  ],
};

describe("public property booking integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    api.fetchProperty.mockResolvedValue(property);
    api.fetchOptions.mockResolvedValue(availableOptions);
  });

  it("renders the real booking panel and removes the obsolete placeholder", async () => {
    render(<PublicPropertyPage />);

    expect(await screen.findByRole("complementary", { name: "رزرو اقامتگاه" })).toBeTruthy();
    expect(screen.queryByText("رزرو در نسخه بعدی فعال می‌شود")).toBeNull();
    expect(screen.getByTestId("booking-date-picker")).toBeTruthy();
    expect(screen.getByTestId("booking-guest-selector")).toBeTruthy();
    expect(screen.getByRole("button", { name: "بررسی موجودی" })).toBeTruthy();
  });

  it("shows loading, room selection, quantity, add-to-cart, and the mobile action bar", async () => {
    let resolveOptions: (value: typeof availableOptions) => void = () => undefined;
    api.fetchOptions.mockReturnValue(new Promise((resolve) => { resolveOptions = resolve; }));
    render(<PublicPropertyPage />);
    const availabilityButton = await screen.findByRole("button", { name: "بررسی موجودی" });

    fireEvent.click(availabilityButton);
    expect(availabilityButton.hasAttribute("disabled")).toBe(true);
    resolveOptions(availableOptions);

    expect(await screen.findByRole("combobox", { name: "نوع اتاق" })).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "تعداد اتاق" })).toBeTruthy();
    const addButton = screen.getByRole("button", { name: "افزودن به سبد رزرو" });
    fireEvent.click(addButton);

    expect(await screen.findByRole("heading", { name: "سبد رزرو" })).toBeTruthy();
    expect(screen.getByTestId("booking-mobile-action-bar")).toBeTruthy();
  });

  it("exposes empty and error booking-options states", async () => {
    api.fetchOptions.mockResolvedValueOnce({ ...availableOptions, roomTypes: [] });
    const firstRender = render(<PublicPropertyPage />);
    fireEvent.click(await screen.findByRole("button", { name: "بررسی موجودی" }));
    expect(await screen.findByText("برای این بازه اتاقی در دسترس نیست.")).toBeTruthy();
    firstRender.unmount();

    api.fetchOptions.mockRejectedValueOnce(new Error("ارتباط با سرویس موجودی برقرار نشد."));
    render(<PublicPropertyPage />);
    fireEvent.click(await screen.findByRole("button", { name: "بررسی موجودی" }));
    await waitFor(() => {
      expect(screen.getByText("ارتباط با سرویس موجودی برقرار نشد.")).toBeTruthy();
    });
  });
});
