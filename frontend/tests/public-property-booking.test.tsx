import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  fetchProperty: vi.fn(),
  fetchOptions: vi.fn(),
}));
const navigation = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));

const searchParams = new URLSearchParams({
  checkIn: "2030-08-10",
  checkOut: "2030-08-12",
  adults: "2",
  rooms: "1",
});

vi.mock("next/navigation", () => ({
  useParams: () => ({ slug: "kashan-house" }),
  usePathname: () => "/properties/kashan-house",
  useRouter: () => navigation,
  useSearchParams: () => searchParams,
}));
vi.mock("@/components/auth/AuthSessionProvider", () => ({
  useAuthSession: () => ({ authenticated: false, loading: false }),
}));
vi.mock("@/components/KoochDatePicker", () => ({
  KoochDatePicker: ({ onChange }: { onChange: (value: { startDate: string; endDate: string }) => void }) => (
    <div data-testid="booking-date-picker">
      انتخاب تاریخ اقامت
      <button type="button" onClick={() => onChange({ startDate: "2030-08-20", endDate: "2030-08-22" })}>
        تغییر تاریخ آزمایشی
      </button>
    </div>
  ),
}));
vi.mock("@/components/GuestSelector", () => ({
  GuestSelector: ({ onChange }: { onChange: (value: { adults: number; children: number; childAges: number[]; rooms: number }) => void }) => (
    <div data-testid="booking-guest-selector">
      انتخاب مهمان و تعداد اتاق
      <button type="button" onClick={() => onChange({ adults: 3, children: 0, childAges: [], rooms: 1 })}>
        تغییر مهمانان آزمایشی
      </button>
    </div>
  ),
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
import { formatBookingDateRange } from "@/components/booking/booking-display";
import {
  bookingCartStorageKey,
  expandBookingCartSelection,
} from "@/components/booking/BookingCartProvider";

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
    expect(screen.getByRole("heading", { name: "انتخاب‌های شما" })).toBeTruthy();
    expect(screen.getByText("هنوز اتاقی انتخاب نکرده‌اید.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "ادامه رزرو" })).toBeNull();
    expect(screen.getByRole("complementary", { name: "رزرو اقامتگاه" }).parentElement?.className)
      .not.toContain("lg:grid-cols");
  });

  it("uses an accessible multi-unit stepper and keeps the mobile action bar", async () => {
    let resolveOptions: (value: typeof availableOptions) => void = () => undefined;
    api.fetchOptions.mockReturnValue(new Promise((resolve) => { resolveOptions = resolve; }));
    render(<PublicPropertyPage />);
    const availabilityButton = await screen.findByRole("button", { name: "بررسی موجودی" });

    fireEvent.click(availabilityButton);
    expect(availabilityButton.hasAttribute("disabled")).toBe(true);
    resolveOptions(availableOptions);

    expect(await screen.findByRole("list", { name: "اتاق‌های قابل انتخاب" })).toBeTruthy();
    expect(screen.getByTestId("booking-choices-summary").parentElement?.className)
      .toContain("lg:grid-cols-[minmax(0,1fr)_minmax(280px,340px)]");
    expect(screen.getByTestId("booking-choices-summary").className).toContain("lg:sticky");
    expect(screen.queryByRole("combobox", { name: "تعداد واحد" })).toBeNull();
    expect(screen.getByText("۴٬۰۰۰٬۰۰۰ تومان")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "انتخاب اتاق شاه‌نشین" }));
    expect(screen.getByText("۱", { selector: "output" })).toBeTruthy();
    const increase = screen.getByRole("button", { name: "افزایش تعداد اتاق شاه‌نشین" });
    fireEvent.click(increase);
    fireEvent.click(increase);

    expect(await screen.findByRole("heading", { name: "انتخاب‌های شما" })).toBeTruthy();
    expect(screen.getByTestId("booking-mobile-action-bar")).toBeTruthy();
    expect(screen.getAllByText(/۳ اتاق/).length).toBeGreaterThan(0);
    expect(increase.hasAttribute("disabled")).toBe(true);
    expect(screen.getByText("۳", { selector: "output" })).toBeTruthy();
    fireEvent.click(screen.getAllByRole("button", { name: "ادامه رزرو" })[0]);
    expect(navigation.push).toHaveBeenCalledWith("/booking/checkout?step=information");
  });

  it("shows a disabled sold-out state when no unit is selectable", async () => {
    api.fetchOptions.mockResolvedValueOnce({
      ...availableOptions,
      roomTypes: [{ ...availableOptions.roomTypes[0], availableCount: 0 }],
    });
    render(<PublicPropertyPage />);

    fireEvent.click(await screen.findByRole("button", { name: "بررسی موجودی" }));

    const soldOut = await screen.findByRole("button", { name: "تکمیل ظرفیت اتاق شاه‌نشین" });
    expect(soldOut.hasAttribute("disabled")).toBe(true);
    expect(soldOut.textContent).toBe("تکمیل ظرفیت");
  });

  it("selects and unselects a single available unit without a quantity control", async () => {
    api.fetchOptions.mockResolvedValueOnce({
      ...availableOptions,
      roomTypes: [{ ...availableOptions.roomTypes[0], availableCount: 1 }],
    });
    render(<PublicPropertyPage />);

    fireEvent.click(await screen.findByRole("button", { name: "بررسی موجودی" }));
    fireEvent.click(await screen.findByRole("button", { name: "انتخاب اتاق شاه‌نشین" }));

    expect(screen.queryByRole("button", { name: /افزایش تعداد/ })).toBeNull();
    expect(screen.queryByRole("combobox", { name: "تعداد واحد" })).toBeNull();
    const removeSelection = screen.getByRole("button", { name: "حذف انتخاب اتاق شاه‌نشین" });
    expect(removeSelection.textContent).toContain("انتخاب شد");
    fireEvent.click(removeSelection);
    expect(await screen.findByRole("button", { name: "انتخاب اتاق شاه‌نشین" })).toBeTruthy();
    expect(screen.getByText("هنوز اتاقی انتخاب نکرده‌اید.")).toBeTruthy();
    expect(screen.queryByTestId("booking-mobile-action-bar")).toBeNull();
  });

  it("increments and decrements a multi-unit selection through zero", async () => {
    api.fetchOptions.mockResolvedValueOnce({
      ...availableOptions,
      roomTypes: [{ ...availableOptions.roomTypes[0], availableCount: 2 }],
    });
    render(<PublicPropertyPage />);

    fireEvent.click(await screen.findByRole("button", { name: "بررسی موجودی" }));
    fireEvent.click(await screen.findByRole("button", { name: "انتخاب اتاق شاه‌نشین" }));

    const increase = screen.getByRole("button", { name: "افزایش تعداد اتاق شاه‌نشین" });
    const decrease = screen.getByRole("button", { name: "کاهش تعداد اتاق شاه‌نشین" });
    expect(increase.className).toContain("[@media(pointer:coarse)]:min-w-11");
    expect(decrease.className).toContain("[@media(pointer:coarse)]:min-h-11");
    expect(screen.getByText("۱", { selector: "output" })).toBeTruthy();
    fireEvent.click(increase);
    expect(screen.getByText("۲", { selector: "output" })).toBeTruthy();
    expect(increase.hasAttribute("disabled")).toBe(true);

    fireEvent.click(decrease);
    expect(screen.getByText("۱", { selector: "output" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "کاهش تعداد اتاق شاه‌نشین" }));
    expect(await screen.findByRole("button", { name: "انتخاب اتاق شاه‌نشین" })).toBeTruthy();
  });

  it("respects cart-aware remaining capacity for the same RoomType", async () => {
    api.fetchOptions.mockResolvedValueOnce({
      ...availableOptions,
      roomTypes: [{ ...availableOptions.roomTypes[0], availableCount: 2 }],
    });
    const existingItems = expandBookingCartSelection({
      propertyId: 1,
      propertyName: property.name,
      propertySlug: property.slug,
      bookingMode: "Instant",
      roomTypeId: 10,
      roomTypeName: property.roomTypes[0].name,
      checkIn: "2030-08-10",
      checkOut: "2030-08-12",
      adults: 2,
      children: 0,
      childAges: [],
      notes: null,
      displayAmount: 4_000_000,
      currency: "IRR",
      quantity: 1,
    });
    sessionStorage.setItem(bookingCartStorageKey, JSON.stringify({
      propertyId: 1,
      propertyName: property.name,
      propertySlug: property.slug,
      bookingMode: "Instant",
      idempotencyKey: "overlap-test",
      checkoutRequested: false,
      items: existingItems,
    }));
    render(<PublicPropertyPage />);

    fireEvent.click(await screen.findByRole("button", { name: "بررسی موجودی" }));

    const increase = await screen.findByRole("button", { name: "افزایش تعداد اتاق شاه‌نشین" });
    expect(screen.getByText("۱", { selector: "output" })).toBeTruthy();
    fireEvent.click(increase);
    expect(screen.getByText("۲", { selector: "output" })).toBeTruthy();
    expect(increase.hasAttribute("disabled")).toBe(true);
  });

  it("keeps the current cart or replaces it only after confirming a changed stay", async () => {
    const existingItems = expandBookingCartSelection({
      propertyId: 1,
      propertyName: property.name,
      propertySlug: property.slug,
      bookingMode: "Instant",
      roomTypeId: 10,
      roomTypeName: property.roomTypes[0].name,
      checkIn: "2030-08-08",
      checkOut: "2030-08-10",
      adults: 2,
      children: 0,
      childAges: [],
      notes: null,
      displayAmount: 4_000_000,
      currency: "IRR",
      quantity: 1,
    });
    sessionStorage.setItem(bookingCartStorageKey, JSON.stringify({
      propertyId: 1,
      propertyName: property.name,
      propertySlug: property.slug,
      bookingMode: "Instant",
      idempotencyKey: "old-stay",
      checkoutRequested: false,
      items: existingItems,
    }));
    render(<PublicPropertyPage />);

    fireEvent.click(await screen.findByRole("button", { name: "بررسی موجودی" }));
    fireEvent.click(await screen.findByRole("button", { name: "انتخاب اتاق شاه‌نشین" }));

    let dialog = await screen.findByRole("alertdialog", {
      name: "سبد رزرو شما مربوط به اقامت دیگری است",
    });
    expect(within(dialog).getByText("اقامت فعلی سبد")).toBeTruthy();
    expect(within(dialog).getByText("اقامت جدید")).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "حفظ سبد فعلی" }));

    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(JSON.parse(sessionStorage.getItem(bookingCartStorageKey)!).items[0].checkIn).toBe("2030-08-08");

    fireEvent.click(screen.getByRole("button", { name: "انتخاب اتاق شاه‌نشین" }));
    dialog = await screen.findByRole("alertdialog", {
      name: "سبد رزرو شما مربوط به اقامت دیگری است",
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "شروع رزرو جدید" }));

    await waitFor(() => {
      const stored = JSON.parse(sessionStorage.getItem(bookingCartStorageKey)!);
      expect(stored.items).toHaveLength(1);
      expect(stored.items[0].checkIn).toBe("2030-08-10");
      expect(stored.idempotencyKey).not.toBe("old-stay");
      expect(within(screen.getByTestId("booking-choices-summary")).getByText(
        formatBookingDateRange("2030-08-10", "2030-08-12"),
      )).toBeTruthy();
    });
  });

  it("requires replacement confirmation when the guest composition changes", async () => {
    const existingItems = expandBookingCartSelection({
      propertyId: 1,
      propertyName: property.name,
      propertySlug: property.slug,
      bookingMode: "Instant",
      roomTypeId: 10,
      roomTypeName: property.roomTypes[0].name,
      checkIn: "2030-08-10",
      checkOut: "2030-08-12",
      adults: 2,
      children: 0,
      childAges: [],
      notes: null,
      displayAmount: 4_000_000,
      currency: "IRR",
      quantity: 1,
    });
    sessionStorage.setItem(bookingCartStorageKey, JSON.stringify({
      propertyId: 1,
      propertyName: property.name,
      propertySlug: property.slug,
      bookingMode: "Instant",
      idempotencyKey: "old-guests",
      checkoutRequested: false,
      items: existingItems,
    }));
    api.fetchOptions.mockResolvedValueOnce({ ...availableOptions, adults: 3 });
    render(<PublicPropertyPage />);

    fireEvent.click(await screen.findByRole("button", { name: "تغییر مهمانان آزمایشی" }));
    fireEvent.click(screen.getByRole("button", { name: "بررسی موجودی" }));
    fireEvent.click(await screen.findByRole("button", { name: "انتخاب اتاق شاه‌نشین" }));

    const dialog = await screen.findByRole("alertdialog", {
      name: "سبد رزرو شما مربوط به اقامت دیگری است",
    });
    const stayDetails = within(dialog).getAllByRole("definition");
    expect(stayDetails[0].textContent).toContain("۲ بزرگسال");
    expect(stayDetails[1].textContent).toContain("۳ بزرگسال");
  });

  it("allows two different RoomTypes to be selected in the same stay", async () => {
    api.fetchOptions.mockResolvedValueOnce({
      ...availableOptions,
      roomTypes: [
        { ...availableOptions.roomTypes[0], availableCount: 1 },
        {
          ...availableOptions.roomTypes[0],
          roomTypeId: 20,
          name: "اتاق نیلوفر",
          availableCount: 1,
          finalAmount: 3_000_000,
        },
      ],
    });
    render(<PublicPropertyPage />);

    fireEvent.click(await screen.findByRole("button", { name: "بررسی موجودی" }));
    fireEvent.click(await screen.findByRole("button", { name: "انتخاب اتاق شاه‌نشین" }));
    fireEvent.click(screen.getByRole("button", { name: "انتخاب اتاق نیلوفر" }));

    expect(screen.getByRole("button", { name: "حذف انتخاب اتاق شاه‌نشین" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "حذف انتخاب اتاق نیلوفر" })).toBeTruthy();
    expect(screen.getAllByText(/۱ اتاق/).length).toBeGreaterThanOrEqual(2);
  });

  it("uses the refreshed maximum after dates change without deleting the old cart", async () => {
    api.fetchOptions
      .mockResolvedValueOnce({
        ...availableOptions,
        roomTypes: [{ ...availableOptions.roomTypes[0], availableCount: 2 }],
      })
      .mockResolvedValueOnce({
        ...availableOptions,
        checkInDate: "2030-08-20",
        checkOutDate: "2030-08-22",
        roomTypes: [{ ...availableOptions.roomTypes[0], availableCount: 1 }],
      });
    render(<PublicPropertyPage />);

    fireEvent.click(await screen.findByRole("button", { name: "بررسی موجودی" }));
    fireEvent.click(await screen.findByRole("button", { name: "انتخاب اتاق شاه‌نشین" }));
    fireEvent.click(screen.getByRole("button", { name: "افزایش تعداد اتاق شاه‌نشین" }));
    expect(screen.getByText("۲", { selector: "output" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "تغییر تاریخ آزمایشی" }));
    fireEvent.click(screen.getByRole("button", { name: "بررسی موجودی" }));

    expect(await screen.findByRole("button", { name: "انتخاب اتاق شاه‌نشین" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "افزایش تعداد اتاق شاه‌نشین" })).toBeNull();
    expect(screen.getAllByText(/۲ اتاق/).length).toBeGreaterThanOrEqual(1);
  });

  it("surfaces an actionable state when refreshed availability drops below cart quantity", async () => {
    api.fetchOptions
      .mockResolvedValueOnce({
        ...availableOptions,
        roomTypes: [{ ...availableOptions.roomTypes[0], availableCount: 2 }],
      })
      .mockResolvedValueOnce({
        ...availableOptions,
        roomTypes: [{ ...availableOptions.roomTypes[0], availableCount: 1 }],
      });
    render(<PublicPropertyPage />);

    fireEvent.click(await screen.findByRole("button", { name: "بررسی موجودی" }));
    fireEvent.click(await screen.findByRole("button", { name: "انتخاب اتاق شاه‌نشین" }));
    fireEvent.click(screen.getByRole("button", { name: "افزایش تعداد اتاق شاه‌نشین" }));
    fireEvent.click(screen.getByRole("button", { name: "بررسی موجودی" }));

    expect(await screen.findByText(/موجودی جدید حداکثر ۱ واحد است/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "افزایش تعداد اتاق شاه‌نشین" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByText("۲", { selector: "output" })).toBeTruthy();
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
      expect(await screen.findByRole("list", { name: "اتاق‌های قابل انتخاب" })).toBeTruthy();

      fireEvent.click(screen.getByRole("button", { name: "انتخاب این اتاق" }));

      await waitFor(() => {
        expect(scrollIntoView).toHaveBeenCalled();
        expect(screen.getByText("انتخاب‌شده از صفحه اتاق‌ها")).toBeTruthy();
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

    expect(await screen.findByRole("button", { name: "انتخاب اتاق شاه‌نشین" })).toBeTruthy();
    expect(screen.queryByRole("combobox", { name: "اتاق مشخص" })).toBeNull();
    expect(screen.queryByRole("combobox", { name: "تعداد واحد" })).toBeNull();
    expect(screen.queryByText(/اتاق‌های نام‌دار باید/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "انتخاب اتاق شاه‌نشین" }));
    expect(await screen.findByText("۱ واحد از اتاق شاه‌نشین به سبد رزرو اضافه شد.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "حذف انتخاب اتاق شاه‌نشین" })).toBeTruthy();
  });
});
