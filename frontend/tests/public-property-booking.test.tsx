import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
  roomTypes: [
    {
      id: 10,
      name: "اتاق شاه‌نشین",
      englishName: null,
      description: "اتاقی رو به حیاط مرکزی",
      basePrice: 2_000_000,
      availabilityPrice: 2_000_000,
      displayPrice: 2_000_000,
      availabilityStatus: "Available" as const,
      inventoryMode: "TypeBasedInventory" as const,
      totalInventory: 3,
      activeRoomCount: 0,
      maxAdults: 2,
      maxChildren: 1,
      allowExtraGuest: false,
      maxExtraGuests: 0,
      notes: null,
      floorNumber: 1,
      stairCount: 4,
      hasWindow: true,
      hasPrivateBathroom: true,
      bedInformation: ["1 x Double Bed"],
      images: [
        { id: 101, url: "/room-1.jpg", altText: "نمای اتاق شاه‌نشین", caption: "نمای اصلی", tag: null, isCover: true },
        { id: 102, url: "/room-2.jpg", altText: "حیاط اتاق شاه‌نشین", caption: null, tag: null, isCover: false },
      ],
      amenities: [{ id: 1, name: "حمام اختصاصی", category: "اتاق" }],
    },
  ],
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
  unavailableRoomTypes: [],
  roomTypes: [
    {
      roomTypeId: 10,
      name: "اتاق شاه‌نشین",
      englishName: null,
      inventoryMode: "TypeBasedInventory" as const,
      availableCount: 3,
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
    expect(screen.getByText("مبلغ قطعی این بازه برای هر اتاق: ۴٬۰۰۰٬۰۰۰ تومان")).toBeTruthy();
    const quantity = screen.getByRole("combobox", { name: "تعداد واحد" });
    expect(quantity).toBeTruthy();
    expect(within(quantity).getByRole("option", { name: "۳" })).toBeTruthy();
    fireEvent.change(quantity, { target: { value: "3" } });
    const addButton = screen.getByRole("button", { name: "افزودن ۳ واحد به سبد رزرو" });
    fireEvent.click(addButton);

    expect(await screen.findByRole("heading", { name: "سبد رزرو" })).toBeTruthy();
    expect(screen.getByTestId("booking-mobile-action-bar")).toBeTruthy();
    expect(screen.getAllByText("۳ واحد").length).toBeGreaterThan(0);
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
  });

  it("exposes empty and error booking-options states", async () => {
    api.fetchOptions.mockResolvedValueOnce({
      ...availableOptions,
      roomTypes: [],
      unavailableRoomTypes: [
        {
          roomTypeId: 10,
          name: property.roomTypes[0].name,
          reason: "InsufficientAvailability",
        },
      ],
    });
    const firstRender = render(<PublicPropertyPage />);
    fireEvent.click(await screen.findByRole("button", { name: "بررسی موجودی" }));
    expect(await screen.findByText(/در این بازه ظرفیت قابل رزرو وجود ندارد/)).toBeTruthy();
    firstRender.unmount();

    api.fetchOptions.mockRejectedValueOnce(new Error("ارتباط با سرویس موجودی برقرار نشد."));
    render(<PublicPropertyPage />);
    fireEvent.click(await screen.findByRole("button", { name: "بررسی موجودی" }));
    await waitFor(() => {
      expect(screen.getByText("ارتباط با سرویس موجودی برقرار نشد.")).toBeTruthy();
    });
  });

  it("opens accessible room details with every image", async () => {
    render(<PublicPropertyPage />);

    fireEvent.click(await screen.findByRole("button", { name: "مشاهده جزئیات" }));

    const dialog = await screen.findByRole("dialog", { name: "جزئیات اتاق شاه‌نشین" });
    expect(within(dialog).getByAltText("نمای اتاق شاه‌نشین")).toBeTruthy();
    expect(within(dialog).getByAltText("حیاط اتاق شاه‌نشین")).toBeTruthy();
    expect(within(dialog).getByText("حمام اختصاصی")).toBeTruthy();
  });

  it("selects the room type from its card and scrolls to the panel on mobile", async () => {
    const scrollIntoView = vi.fn();
    const originalMatchMedia = window.matchMedia;
    const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;
    window.matchMedia = vi.fn().mockReturnValue({ matches: true });
    HTMLElement.prototype.scrollIntoView = scrollIntoView;
    api.fetchOptions.mockResolvedValueOnce({
      ...availableOptions,
      roomTypes: [
        { ...availableOptions.roomTypes[0], roomTypeId: 20, name: "اتاق دیگر" },
        availableOptions.roomTypes[0],
      ],
    });

    try {
      render(<PublicPropertyPage />);
      fireEvent.click(await screen.findByRole("button", { name: "بررسی موجودی" }));
      const roomTypeSelect = await screen.findByRole("combobox", { name: "نوع اتاق" });
      expect((roomTypeSelect as HTMLSelectElement).value).toBe("20");

      fireEvent.click(screen.getByRole("button", { name: "انتخاب این اتاق" }));

      await waitFor(() => {
        expect((roomTypeSelect as HTMLSelectElement).value).toBe("10");
        expect(scrollIntoView).toHaveBeenCalled();
      });
      expect(document.activeElement).toBe(
        screen.getByRole("complementary", { name: "رزرو اقامتگاه" }),
      );
      expect(screen.getByText(/انتخاب کارت هنوز به معنی افزودن به سبد نیست/)).toBeTruthy();
    } finally {
      window.matchMedia = originalMatchMedia;
      HTMLElement.prototype.scrollIntoView = originalScrollIntoView;
    }
  });

  it("does not present a zero public price as a valid starting price", async () => {
    api.fetchProperty.mockResolvedValueOnce({
      ...property,
      startingPrice: null,
      roomTypes: [
        {
          ...property.roomTypes[0],
          basePrice: null,
          availabilityPrice: null,
          displayPrice: 0,
        },
      ],
    });

    render(<PublicPropertyPage />);

    expect(await screen.findAllByText("قیمت پس از تعیین در تقویم")).toHaveLength(2);
    expect(screen.queryByText(/۰ تومان \/ شب/)).toBeNull();
  });

  it("explains that incomplete daily pricing makes the selected range unavailable", async () => {
    api.fetchOptions.mockResolvedValueOnce({
      ...availableOptions,
      roomTypes: [],
      unavailableRoomTypes: [
        {
          roomTypeId: 10,
          name: "اتاق شاه‌نشین",
          reason: "IncompleteDailyPricing",
        },
      ],
    });
    render(<PublicPropertyPage />);

    fireEvent.click(await screen.findByRole("button", { name: "بررسی موجودی" }));

    expect(await screen.findByText(/قیمت همه شب‌های این بازه هنوز در تقویم تعیین نشده است/)).toBeTruthy();
  });

  it("keeps a sellable room type selectable without physical rooms", async () => {
    api.fetchProperty.mockResolvedValueOnce({
      ...property,
      roomTypes: [
        {
          ...property.roomTypes[0],
          inventoryMode: "NamedRooms",
          activeRoomCount: 0,
        },
      ],
    });

    render(<PublicPropertyPage />);

    expect(await screen.findByRole("button", { name: "انتخاب این اتاق" })).toBeTruthy();
    expect(screen.queryByText(/هنوز اتاق فعال قابل رزروی/)).toBeNull();
  });

  it("uses the same quantity flow for named and type-based inventory", async () => {
    api.fetchOptions.mockResolvedValueOnce({
      ...availableOptions,
      roomTypes: [
        {
          ...availableOptions.roomTypes[0],
          inventoryMode: "NamedRooms",
          availableCount: 1,
          rooms: [],
        },
      ],
    });
    render(<PublicPropertyPage />);

    fireEvent.click(await screen.findByRole("button", { name: "بررسی موجودی" }));

    const quantity = await screen.findByRole("combobox", { name: "تعداد واحد" });
    expect(screen.queryByRole("combobox", { name: "اتاق مشخص" })).toBeNull();
    expect(screen.queryByText(/اتاق‌های نام‌دار باید/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "افزودن ۱ واحد به سبد رزرو" }));
    expect(await screen.findByText("۱ واحد از اتاق شاه‌نشین به سبد رزرو اضافه شد.")).toBeTruthy();
    expect(screen.getAllByText("۱ واحد").length).toBeGreaterThan(0);
  });
});
