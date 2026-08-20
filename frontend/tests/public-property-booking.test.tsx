import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  fetchProperty: vi.fn(),
  fetchOptions: vi.fn(),
}));
const navigation = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  scrollIntoView: vi.fn(),
}));

let searchParams = new URLSearchParams({
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
vi.mock("@/components/KoochCompactDateRangePicker", () => ({
  KoochCompactDateRangePicker: ({
    calendarType,
    daySpacing,
    disablePastDates,
    fieldSize,
    onChange,
    value,
  }: {
    calendarType: string;
    daySpacing: string;
    disablePastDates: boolean;
    fieldSize: string;
    onChange: (value: { startDate: string | null; endDate: string | null }) => void;
    value: { startDate: string | null; endDate: string | null };
  }) => (
    <div
      data-calendar-type={calendarType}
      data-day-spacing={daySpacing}
      data-disable-past-dates={String(disablePastDates)}
      data-field-size={fieldSize}
      data-testid="booking-date-picker"
    >
      انتخاب تاریخ اقامت
      <output data-testid="booking-date-value">
        {value.startDate ?? ""}|{value.endDate ?? ""}
      </output>
      <button type="button" onClick={() => onChange({ startDate: "2030-08-20", endDate: null })}>
        انتخاب فقط ورود آزمایشی
      </button>
      <button type="button" onClick={() => onChange({ startDate: "2030-08-20", endDate: "2030-08-22" })}>
        تغییر تاریخ آزمایشی
      </button>
      <button type="button" onClick={() => onChange({ startDate: "2030-08-10", endDate: "2030-08-12" })}>
        بازگشت به تاریخ اولیه
      </button>
    </div>
  ),
}));
vi.mock("@/components/GuestSelector", () => ({
  GuestSelector: ({
    className,
    controlClassName,
    onChange,
  }: {
    className?: string;
    controlClassName?: string;
    onChange: (value: { adults: number; children: number; childAges: number[]; rooms: number }) => void;
  }) => (
    <div
      className={className}
      data-control-class={controlClassName}
      data-testid="booking-guest-selector"
    >
      انتخاب مهمان و تعداد اتاق
      <button type="button" onClick={() => onChange({ adults: 3, children: 0, childAges: [], rooms: 1 })}>
        تغییر مهمانان آزمایشی
      </button>
      <button type="button" onClick={() => onChange({ adults: 2, children: 1, childAges: [7], rooms: 1 })}>
        افزودن کودک آزمایشی
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

const changedStayHint = "این نتایج برای تاریخ یا مهمان‌های متفاوتی است. با انتخاب اتاق جدید می‌توانید انتخاب‌های فعلی را جایگزین کنید.";

function storeExistingCart({
  checkIn = "2030-08-10",
  checkOut = "2030-08-12",
  adults = 2,
  children = 0,
  childAges = [],
}: {
  checkIn?: string;
  checkOut?: string;
  adults?: number;
  children?: number;
  childAges?: number[];
} = {}) {
  const items = expandBookingCartSelection({
    propertyId: 1,
    propertyName: property.name,
    propertySlug: property.slug,
    bookingMode: "Instant",
    roomTypeId: 10,
    roomTypeName: property.roomTypes[0].name,
    checkIn,
    checkOut,
    adults,
    children,
    childAges,
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
    idempotencyKey: "context-hint-test",
    checkoutRequested: false,
    items,
  }));
}

describe("public property booking integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    searchParams = new URLSearchParams({
      checkIn: "2030-08-10",
      checkOut: "2030-08-12",
      adults: "2",
      rooms: "1",
    });
    Object.defineProperty(Element.prototype, "scrollIntoView", {
      configurable: true,
      value: navigation.scrollIntoView,
    });
    api.fetchProperty.mockResolvedValue(property);
    api.fetchOptions.mockResolvedValue(availableOptions);
  });

  it("renders the real booking panel and removes the obsolete placeholder", async () => {
    render(<PublicPropertyPage />);

    const roomList = await screen.findByRole("list", { name: "نوع‌های اتاق" });
    expect(screen.queryByText("رزرو در نسخه بعدی فعال می‌شود")).toBeNull();
    const datePicker = screen.getByTestId("booking-date-picker");
    const searchBar = screen.getByTestId("property-search-bar");
    const searchInner = screen.getByTestId("property-search-inner");
    const searchForm = screen.getByRole("form", {
      name: "جستجوی موجودی این اقامتگاه",
    });
    const roomSection = document.getElementById("property-rooms")!;
    expect(datePicker).toBeTruthy();
    expect(searchBar.className).toContain("sticky");
    expect(searchBar.className).toContain("top-16");
    expect(searchBar.className).toContain("z-40");
    expect(searchBar.className).toContain("w-full");
    expect(searchBar.className).toContain("border-b");
    expect(searchBar.className).toContain(
      "bg-[var(--property-search-background)]",
    );
    expect(searchBar.className).not.toContain("bg-background");
    expect(searchBar.className).not.toContain("rounded");
    expect(searchBar.parentElement?.firstElementChild).toBe(searchBar);
    expect(searchInner.className).toContain("mx-auto");
    expect(searchInner.className).toContain("max-w-7xl");
    expect(searchInner.className).toContain("px-5");
    expect(searchInner.className).toContain("sm:px-8");
    expect(searchInner.contains(searchForm)).toBe(true);
    expect(screen.getAllByRole("form", {
      name: "جستجوی موجودی این اقامتگاه",
    })).toHaveLength(1);
    expect(within(searchForm).getByText(property.name)).toBeTruthy();
    expect(screen.getByTestId("booking-guest-selector")).toBeTruthy();
    expect(screen.getByRole("button", { name: "بررسی موجودی" })).toBeTruthy();
    expect(datePicker.compareDocumentPosition(roomList) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(roomSection.className).toContain("scroll-mt-80");
    expect(roomSection.className).toContain("sm:scroll-mt-64");
    expect(roomSection.className).toContain("xl:scroll-mt-44");
    expect(within(roomSection).queryByTestId("booking-date-picker")).toBeNull();
    expect(within(roomSection).queryByTestId("booking-guest-selector")).toBeNull();
    expect(within(roomSection).queryByRole("button", { name: "بررسی موجودی" })).toBeNull();
    expect(within(roomList).getAllByRole("listitem")).toHaveLength(1);
    expect(screen.queryByRole("heading", { name: "انتخاب‌های شما" })).toBeNull();
    expect(screen.queryByRole("button", { name: "انتخاب اتاق شاه‌نشین" })).toBeNull();
    expect(screen.queryByRole("button", { name: "ادامه رزرو" })).toBeNull();
  });

  it("defines a property search surface for every color theme and appearance", () => {
    const css = readFileSync(resolve(process.cwd(), "app/globals.css"), "utf8");
    const panelSource = readFileSync(
      resolve(process.cwd(), "components/booking/PropertyBookingPanel.tsx"),
      "utf8",
    );
    const expectedTokens = [
      [':root[data-theme="ocean"]', "#20274d"],
      [':root[data-theme="forest"]', "#183d2a"],
      [':root[data-theme="royal"]', "#37254f"],
      [':root[data-theme="sunset"]', "#4a2d24"],
      [':root.dark[data-theme="ocean"]', "#53608a"],
      [':root.dark[data-theme="forest"]', "#426d53"],
      [':root.dark[data-theme="royal"]', "#6e5883"],
      [':root.dark[data-theme="sunset"]', "#7b5848"],
    ] as const;

    for (const [selector, value] of expectedTokens) {
      const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      expect(css).toMatch(
        new RegExp(
          `${escapedSelector}\\s*\\{[^}]*--property-search-background:\\s*${value};`,
          "i",
        ),
      );
    }

    expect(panelSource).not.toMatch(/theme\s*===|data-theme|kooch_theme/);
    expect(panelSource).not.toMatch(/#20274d|rgb\(32\s*,?\s*39\s*,?\s*77\)/i);
  });

  it("contains the wide nearby-places table inside its own mobile scroller", async () => {
    api.fetchProperty.mockResolvedValue({
      ...property,
      nearbyPlaces: [{
        id: 1,
        title: "بازار تاریخی",
        category: "Landmark",
        distanceInMeters: 500,
        walkingMinutes: 7,
        drivingMinutes: 2,
        description: null,
      }],
    });

    render(<PublicPropertyPage />);

    const heading = await screen.findByRole("heading", { name: "مکان‌های نزدیک" });
    const section = heading.closest("section")!;
    const table = within(section).getByRole("table");
    expect(section.className).toContain("min-w-0");
    expect(table.parentElement?.className).toContain("overflow-x-auto");
  });

  it("uses the compact committed range without triggering availability automatically", async () => {
    render(<PublicPropertyPage />);

    const datePicker = await screen.findByTestId("booking-date-picker");
    const controls = screen.getByTestId("room-availability-controls");
    expect(datePicker.dataset.calendarType).toBe("jalali");
    expect(datePicker.dataset.daySpacing).toBe("compact");
    expect(datePicker.dataset.fieldSize).toBe("compact");
    expect(datePicker.dataset.disablePastDates).toBe("true");
    expect(controls.className).toContain("grid");
    expect(controls.className).toContain("grid-cols-2");
    expect(controls.className).toContain("xl:grid-cols-[minmax(180px,0.8fr)_minmax(320px,1.5fr)_minmax(240px,1fr)_auto]");
    expect(screen.getByTestId("property-search-context").className).toContain("h-12");
    expect(screen.getByTestId("booking-guest-selector").dataset.controlClass).toContain("h-12");
    expect(screen.getByRole("button", { name: "بررسی موجودی" }).className).toContain("h-12");
    expect(screen.queryByText("انتخاب ورود")).toBeNull();
    expect(screen.queryByText("انتخاب خروج")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "انتخاب فقط ورود آزمایشی" }));
    expect(screen.getByTestId("booking-date-value").textContent)
      .toBe("2030-08-10|2030-08-12");
    expect(api.fetchOptions).not.toHaveBeenCalled();
    expect(navigation.scrollIntoView).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "تغییر تاریخ آزمایشی" }));
    expect(screen.getByTestId("booking-date-value").textContent)
      .toBe("2030-08-20|2030-08-22");
    expect(api.fetchOptions).not.toHaveBeenCalled();
    expect(navigation.scrollIntoView).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "بررسی موجودی" }));
    await waitFor(() => expect(api.fetchOptions).toHaveBeenCalledWith(
      "kashan-house",
      expect.objectContaining({
        checkIn: "2030-08-20",
        checkOut: "2030-08-22",
      }),
    ));
    expect(navigation.scrollIntoView).toHaveBeenCalledWith({
      behavior: "smooth",
      block: "start",
    });
  });

  it("does not scroll when committed search inputs are invalid", async () => {
    searchParams.delete("checkIn");
    searchParams.delete("checkOut");
    render(<PublicPropertyPage />);

    fireEvent.click(await screen.findByRole("button", { name: "بررسی موجودی" }));

    expect(await screen.findByText("تاریخ ورود و خروج را انتخاب کنید.")).toBeTruthy();
    expect(api.fetchOptions).not.toHaveBeenCalled();
    expect(navigation.scrollIntoView).not.toHaveBeenCalled();
  });

  it("uses an accessible multi-unit stepper and keeps the mobile action bar", async () => {
    let resolveOptions: (value: typeof availableOptions) => void = () => undefined;
    api.fetchOptions.mockReturnValue(new Promise((resolve) => { resolveOptions = resolve; }));
    render(<PublicPropertyPage />);
    const availabilityButton = await screen.findByRole("button", { name: "بررسی موجودی" });

    fireEvent.click(availabilityButton);
    expect(availabilityButton.hasAttribute("disabled")).toBe(true);
    resolveOptions(availableOptions);

    expect(await screen.findByRole("list", { name: "نوع‌های اتاق" })).toBeTruthy();
    expect(screen.queryByText(changedStayHint)).toBeNull();
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

    expect(screen.queryByText(changedStayHint)).toBeNull();

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
    expect(await screen.findByText(changedStayHint)).toBeTruthy();
    fireEvent.click(await screen.findByRole("button", { name: "انتخاب اتاق شاه‌نشین" }));

    let dialog = await screen.findByRole("alertdialog", {
      name: "سبد رزرو شما مربوط به اقامت دیگری است",
    });
    expect(within(dialog).getByText("اقامت فعلی سبد")).toBeTruthy();
    expect(within(dialog).getByText("اقامت جدید")).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "حفظ سبد فعلی" }));

    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(JSON.parse(sessionStorage.getItem(bookingCartStorageKey)!).items[0].checkIn).toBe("2030-08-08");
    expect(screen.getByText(changedStayHint)).toBeTruthy();

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
      expect(screen.queryByText(changedStayHint)).toBeNull();
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
    expect(await screen.findByText(changedStayHint)).toBeTruthy();
    fireEvent.click(await screen.findByRole("button", { name: "انتخاب اتاق شاه‌نشین" }));

    const dialog = await screen.findByRole("alertdialog", {
      name: "سبد رزرو شما مربوط به اقامت دیگری است",
    });
    const stayDetails = within(dialog).getAllByRole("definition");
    expect(stayDetails[0].textContent).toContain("۲ بزرگسال");
    expect(stayDetails[1].textContent).toContain("۳ بزرگسال");
  });

  it("shows the context hint when the child count differs", async () => {
    storeExistingCart();
    api.fetchOptions.mockResolvedValueOnce({
      ...availableOptions,
      children: 1,
      childAges: [7],
    });
    render(<PublicPropertyPage />);

    fireEvent.click(await screen.findByRole("button", { name: "افزودن کودک آزمایشی" }));
    expect(screen.queryByText(changedStayHint)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "بررسی موجودی" }));

    expect(await screen.findByText(changedStayHint)).toBeTruthy();
  });

  it("shows the context hint when only a child age differs", async () => {
    storeExistingCart({ children: 1, childAges: [5] });
    api.fetchOptions.mockResolvedValueOnce({
      ...availableOptions,
      children: 1,
      childAges: [7],
    });
    render(<PublicPropertyPage />);

    fireEvent.click(await screen.findByRole("button", { name: "افزودن کودک آزمایشی" }));
    fireEvent.click(screen.getByRole("button", { name: "بررسی موجودی" }));

    expect(await screen.findByText(changedStayHint)).toBeTruthy();
  });

  it("does not show a new-context hint when availability fails", async () => {
    storeExistingCart();
    api.fetchOptions.mockRejectedValueOnce(new Error("ارتباط با سرویس موجودی برقرار نشد."));
    render(<PublicPropertyPage />);

    fireEvent.click(await screen.findByRole("button", { name: "تغییر تاریخ آزمایشی" }));
    fireEvent.click(screen.getByRole("button", { name: "بررسی موجودی" }));

    expect(await screen.findByText("ارتباط با سرویس موجودی برقرار نشد.")).toBeTruthy();
    expect(screen.queryByText(changedStayHint)).toBeNull();
    expect(navigation.scrollIntoView).not.toHaveBeenCalled();
  });

  it("removes the hint after searching the original cart context again", async () => {
    storeExistingCart();
    api.fetchOptions
      .mockResolvedValueOnce({
        ...availableOptions,
        checkInDate: "2030-08-20",
        checkOutDate: "2030-08-22",
      })
      .mockResolvedValueOnce(availableOptions);
    render(<PublicPropertyPage />);

    fireEvent.click(await screen.findByRole("button", { name: "تغییر تاریخ آزمایشی" }));
    expect(screen.queryByText(changedStayHint)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "بررسی موجودی" }));
    expect(await screen.findByText(changedStayHint)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "بازگشت به تاریخ اولیه" }));
    expect(screen.queryByText(changedStayHint)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "بررسی موجودی" }));

    await waitFor(() => expect(screen.queryByText(changedStayHint)).toBeNull());
  });

  it("allows two different RoomTypes to be selected in the same stay", async () => {
    api.fetchProperty.mockResolvedValueOnce({
      ...property,
      roomTypes: [
        property.roomTypes[0],
        { ...property.roomTypes[0], id: 20, name: "اتاق نیلوفر", images: [] },
      ],
    });
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
    expect(screen.queryByText(changedStayHint)).toBeNull();
    expect(screen.queryByRole("button", { name: "افزایش تعداد اتاق شاه‌نشین" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "بررسی موجودی" }));

    expect(await screen.findByRole("button", { name: "انتخاب اتاق شاه‌نشین" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "افزایش تعداد اتاق شاه‌نشین" })).toBeNull();
    expect(screen.getAllByRole("heading", { name: "اتاق شاه‌نشین" })).toHaveLength(1);
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

  it("enriches the canonical card after search without rendering a duplicate room list", async () => {
    api.fetchOptions.mockResolvedValueOnce({
      ...availableOptions,
      roomTypes: [
        { ...availableOptions.roomTypes[0], roomTypeId: 20, name: "گزینه بدون کارت عمومی" },
        availableOptions.roomTypes[0],
      ],
    });
    render(<PublicPropertyPage />);

    const canonicalCard = await screen.findByTestId("room-type-card-10");
    expect(screen.getAllByRole("heading", { name: "اتاق شاه‌نشین" })).toHaveLength(1);
    expect(within(canonicalCard).queryByRole("button", { name: "انتخاب اتاق شاه‌نشین" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "بررسی موجودی" }));

    expect(await within(canonicalCard).findByText("مبلغ کل اقامت")).toBeTruthy();
    expect(within(canonicalCard).getByText("رزرو آنی")).toBeTruthy();
    expect(within(canonicalCard).getByRole("button", { name: "انتخاب اتاق شاه‌نشین" })).toBeTruthy();
    expect(screen.getAllByRole("heading", { name: "اتاق شاه‌نشین" })).toHaveLength(1);
    expect(screen.queryByRole("list", { name: "اتاق‌های قابل انتخاب" })).toBeNull();
    expect(screen.queryByText("گزینه بدون کارت عمومی")).toBeNull();
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

    expect(await screen.findAllByText("قیمت پس از تعیین در تقویم")).toHaveLength(1);
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

    expect(await screen.findByRole("button", { name: "مشاهده جزئیات" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "انتخاب اتاق شاه‌نشین" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "بررسی موجودی" }));
    expect(await screen.findByRole("button", { name: "انتخاب اتاق شاه‌نشین" })).toBeTruthy();
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
