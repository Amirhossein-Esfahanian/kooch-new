import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  PropertyCompletionResponse,
  PropertyResponse,
} from "@/lib/owner-api";

const api = vi.hoisted(() => ({
  request: vi.fn(),
  replaceCommonAreas: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

vi.mock("@/components/auth/AuthSessionProvider", () => ({
  useAuthSession: () => ({
    authenticated: true,
    loading: false,
    workspaces: ["owner", "admin"],
  }),
}));

vi.mock("@/components/owner/PropertyImageManager", () => ({
  PropertyImageManager: () => <div data-testid="property-image-manager">مدیریت تصاویر</div>,
}));

vi.mock("@/components/property/PropertyLocationPicker", () => ({
  PropertyLocationPicker: ({
    onChange,
    value,
  }: {
    onChange: (
      value: { latitude: number; longitude: number } | null,
    ) => void;
    value: { latitude: number; longitude: number } | null;
  }) => (
    <div data-coordinates={value ? JSON.stringify(value) : "null"} data-testid="property-location-picker">
      <button
        onClick={() => onChange({ latitude: 35.123456, longitude: 50.654321 })}
        type="button"
      >
        انتخاب موقعیت آزمایشی
      </button>
      <button onClick={() => onChange(null)} type="button">
        پاک کردن موقعیت
      </button>
    </div>
  ),
}));

vi.mock("@/lib/owner-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/owner-api")>();
  return {
    ...actual,
    apiRequest: api.request,
    replacePropertyCommonAreas: api.replaceCommonAreas,
  };
});

import { PropertyWizard } from "@/components/owner/PropertyWizard";

const property: PropertyResponse = {
  id: 17,
  ownerId: 1,
  ownerName: "مالک",
  ownerEmail: "owner@example.com",
  createdAtUtc: "2030-01-01T00:00:00Z",
  destinationId: 1,
  destinationName: "کاشان",
  name: "سرای آزمون",
  englishName: "Test House",
  slug: "test-house",
  description: "معرفی اقامتگاه",
  seoTitle: null,
  seoDescription: null,
  address: "نشانی",
  city: "شیراز",
  country: "Iran",
  latitude: null,
  longitude: null,
  status: "Draft",
  type: "TraditionalHouse",
  inventoryMode: "NamedRooms",
  checkInTime: "14:00",
  checkOutTime: "12:00",
  breakfastOption: "NoBreakfast",
  breakfastPrice: null,
  totalAreaM2: null,
  landAreaM2: null,
  floorsCount: 1,
  stairCount: null,
  hasElevator: false,
  isWheelchairAccessible: false,
  hasGroundFloorRoom: false,
  hasAccessibleBathroom: false,
  freeChildAgeLimit: null,
  maxFreeChildren: null,
  childPrice: null,
  extraGuestPrice: null,
};

let loadedProperty = property;

const completion = {
  propertyId: 17,
  completionPercentage: 50,
  healthStatus: "NeedsAttention",
  sections: [
    {
      key: "rooms",
      label: "اتاق‌های فعال",
      status: "NotStarted",
      missingItems: ["حداقل یک اتاق فعال"],
      actionTarget: "rooms",
    },
    {
      key: "pricing",
      label: "قیمت‌گذاری اقامتگاه",
      status: "Incomplete",
      missingItems: ["حداقل یک قیمت ثبت‌شده"],
      actionTarget: "pricing",
    },
    {
      key: "availability",
      label: "موجودی رزرو",
      status: "NotStarted",
      missingItems: ["حداقل یک روز موجود"],
      actionTarget: "availability",
    },
    {
      key: "financial",
      label: "وضعیت مالی آزمایشی",
      status: "Incomplete",
      missingItems: ["قیمت کودک"],
      actionTarget: "financial",
    },
  ],
  warnings: [],
  completedSections: [],
  missingSections: ["rooms", "pricing", "availability", "financial"],
  canActivate: false,
} satisfies PropertyCompletionResponse;

const existingCommonAreas = [
  { id: 1, propertyId: 17, name: "حیاط", description: "کنار حوض", sortOrder: 1 },
  { id: 2, propertyId: 17, name: "بام", description: null, sortOrder: 2 },
];

const amenityCategory = {
  id: 2,
  name: "خدمات پایه",
  slug: "base-services",
  sortOrder: 1,
  icon: "/svgs/amenity-categories/base-services.svg",
  isActive: true,
};

const wifiAmenity = {
  id: 7,
  amenityCategoryId: amenityCategory.id,
  categoryName: amenityCategory.name,
  categorySlug: amenityCategory.slug,
  categorySortOrder: amenityCategory.sortOrder,
  name: "اینترنت بی‌سیم",
  slug: "wifi",
  description: null,
  icon: "/svgs/amenities/wifi.svg",
  scope: "Both" as const,
  sortOrder: 1,
};

const bathroomCategory = {
  id: 3,
  name: "Bathroom",
  slug: "bathroom",
  sortOrder: 2,
  icon: "/uploads/amenity-categories/3/bathroom.svg",
  isActive: true,
};

const showerAmenity = {
  id: 8,
  amenityCategoryId: bathroomCategory.id,
  categoryName: bathroomCategory.name,
  categorySlug: bathroomCategory.slug,
  categorySortOrder: bathroomCategory.sortOrder,
  name: "Shower",
  slug: "shower",
  description: null,
  icon: "/uploads/amenities/8/shower.svg",
  scope: "Both" as const,
  sortOrder: 1,
};

let loadedAmenityCategories = [amenityCategory];
let loadedAmenities = [wifiAmenity];
let loadedPropertyAmenities = [
  {
    amenityId: wifiAmenity.id,
    name: wifiAmenity.name,
    amenityCategoryId: amenityCategory.id,
    categoryName: amenityCategory.name,
  },
];

const propertySettingCatalog = [
  { id: 1, name: "بافت تاریخی", slug: "historic-district", sortOrder: 10, isActive: true },
  { id: 2, name: "محدوده بازار", slug: "bazaar-area", sortOrder: 20, isActive: true },
  { id: 3, name: "بافت روستایی", slug: "rural-setting", sortOrder: 30, isActive: true },
  { id: 4, name: "بافت کویری", slug: "desert-setting", sortOrder: 40, isActive: true },
  { id: 5, name: "مرکز شهر", slug: "city-center", sortOrder: 50, isActive: true },
  { id: 6, name: "منطقه کوهستانی", slug: "mountainous-area", sortOrder: 60, isActive: true },
  { id: 7, name: "بافت مسکونی", slug: "residential-area", sortOrder: 70, isActive: true },
  { id: 8, name: "حاشیه شهر", slug: "city-outskirts", sortOrder: 80, isActive: true },
];
const inactiveAssignedPropertySetting = {
  id: 9,
  name: "بافت قدیمی غیرفعال",
  slug: "inactive-historic",
  isActive: false,
};
const inactiveUnassignedPropertySetting = {
  id: 10,
  name: "گزینه غیرفعال انتخاب‌نشده",
  slug: "inactive-unassigned",
  sortOrder: 90,
  isActive: false,
};

let loadedPropertySettings = propertySettingCatalog;
let loadedAssignedPropertySettings: Array<{
  id: number;
  name: string;
  slug: string;
  isActive: boolean;
}> = [];
let propertySettingsPutError: Error | null = null;

describe("PropertyWizard media and common areas", () => {
  beforeEach(() => {
    loadedProperty = property;
    loadedAmenityCategories = [];
    loadedAmenities = [];
    loadedPropertyAmenities = [];
    loadedPropertySettings = propertySettingCatalog;
    loadedAssignedPropertySettings = [];
    propertySettingsPutError = null;
    api.request.mockReset();
    api.replaceCommonAreas.mockReset();
    api.request.mockImplementation((path: string, init?: RequestInit) => {
      if (path === "/amenity-categories") return Promise.resolve(loadedAmenityCategories);
      if (path === "/amenities") return Promise.resolve(loadedAmenities);
      if (path === "/property-settings") return Promise.resolve(loadedPropertySettings);
      if (path === "/owner/properties" && init?.method === "POST") {
        return Promise.resolve(loadedProperty);
      }
      if (path === "/owner/properties/17") return Promise.resolve(loadedProperty);
      if (path === "/admin/properties/17") return Promise.resolve(loadedProperty);
      if (path === "/owner/properties/17/completion") return Promise.resolve(completion);
      if (path === "/admin/properties/17/completion") return Promise.resolve(completion);
      if (path === "/owner/properties/17/descriptions") {
        return init?.method === "POST"
          ? Promise.resolve({ id: 10, propertyId: 17, sectionType: "PropertyIntroduction", title: "معرفی اقامتگاه", content: "معرفی اقامتگاه", sortOrder: 1 })
          : Promise.resolve([]);
      }
      if (path === "/owner/properties/17/images") return Promise.resolve([]);
      if (path === "/owner/properties/17/amenities") return Promise.resolve(loadedPropertyAmenities);
      if (path === "/owner/properties/17/common-areas") return Promise.resolve(existingCommonAreas);
      if (path === "/owner/properties/17/nearby-places") return Promise.resolve([]);
      if (path === "/owner/properties/17/settings") {
        if (init?.method !== "PUT") {
          return Promise.resolve(loadedAssignedPropertySettings);
        }
        if (propertySettingsPutError) return Promise.reject(propertySettingsPutError);
        const ids = (JSON.parse(String(init.body)).propertySettingIds ?? []) as number[];
        const candidates = [
          ...loadedPropertySettings,
          ...loadedAssignedPropertySettings,
        ];
        loadedAssignedPropertySettings = ids
          .map((id) => candidates.find((setting) => setting.id === id))
          .filter((setting): setting is NonNullable<typeof setting> => Boolean(setting))
          .map(({ id, name, slug, isActive }) => ({ id, name, slug, isActive }));
        return Promise.resolve(loadedAssignedPropertySettings);
      }
      if (path === "/owner/properties/17/room-types") return Promise.resolve([]);
      if (path === "/owner/properties/17/sections/description") return Promise.resolve(property);
      if (path === "/owner/properties/17/sections/location" && init?.method === "PUT") {
        const payload = JSON.parse(String(init.body));
        return Promise.resolve({ ...loadedProperty, ...payload });
      }
      if (path === "/admin/properties/17/sections/location" && init?.method === "PUT") {
        const payload = JSON.parse(String(init.body));
        return Promise.resolve({ ...loadedProperty, ...payload });
      }
      if (path === "/owner/properties/17/sections/financial" && init?.method === "PUT") {
        const payload = JSON.parse(String(init.body));
        return Promise.resolve({ ...property, ...payload });
      }
      throw new Error(`Unexpected API request: ${path}`);
    });
    api.replaceCommonAreas.mockResolvedValue([
      { id: 3, propertyId: 17, name: "حیاط مرکزی", description: "کنار حوض", sortOrder: 1 },
      { id: 4, propertyId: 17, name: "ایوان", description: null, sortOrder: 2 },
    ]);
  });

  it("restores amenity selection and saves the same selected ID payload", async () => {
    loadedAmenityCategories = [amenityCategory];
    loadedAmenities = [wifiAmenity];
    loadedPropertyAmenities = [
      {
        amenityId: wifiAmenity.id,
        name: wifiAmenity.name,
        amenityCategoryId: amenityCategory.id,
        categoryName: amenityCategory.name,
      },
    ];
    window.history.replaceState({}, "", "?step=3");
    render(<PropertyWizard mode="edit" propertyId={17} />);

    const card = await screen.findByRole("button", { name: wifiAmenity.name });
    await waitFor(() => expect(card.getAttribute("aria-pressed")).toBe("true"));
    expect(screen.queryByRole("checkbox", { name: wifiAmenity.name })).toBeNull();
    expect(screen.getByRole("heading", { name: "امکانات" })).toBeTruthy();
    expect(screen.queryByText("چشم‌انداز")).toBeNull();
    expect(
      api.request.mock.calls.some(([path]) =>
        String(path).endsWith("/views"),
      ),
    ).toBe(false);

    fireEvent.click(card);
    expect(card.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(screen.getByRole("button", { name: "ذخیره" }));

    await waitFor(() => {
      const call = api.request.mock.calls.find(
        ([path, init]) =>
          path === "/owner/properties/17/amenities" && init?.method === "PUT",
      );
      expect(JSON.parse(String(call?.[1]?.body))).toEqual({ amenityIds: [] });
    });
    expect(
      api.request.mock.calls.some(([path]) =>
        String(path).endsWith("/views"),
      ),
    ).toBe(false);
    expect(
      api.request.mock.calls.some(
        ([path, init]) =>
          path === "/owner/properties/17/settings" && init?.method === "PUT",
      ),
    ).toBe(false);
  });

  it("loads the active PropertySetting catalog in backend order and starts create mode unselected", async () => {
    loadedPropertySettings = [
      ...propertySettingCatalog,
      inactiveUnassignedPropertySetting,
    ];
    window.history.replaceState({}, "", "?step=1");
    const { container } = render(<PropertyWizard mode="create" />);

    expect(
      await screen.findByRole("heading", { name: "بافت و موقعیت محیطی" }),
    ).toBeTruthy();
    expect(
      screen.getByText(
        "ویژگی‌های محیط و محدوده‌ای که اقامتگاه در آن قرار دارد را انتخاب کنید.",
      ),
    ).toBeTruthy();
    const grid = container.querySelector(
      '[data-property-setting-selection-grid="true"]',
    );
    expect(grid?.className).toContain("grid-cols-2");
    expect(grid?.className).toContain("sm:grid-cols-3");
    expect(grid?.className).toContain("lg:grid-cols-4");
    const cards = propertySettingCatalog.map((setting) =>
      screen.getByRole("button", { name: setting.name }),
    );
    expect(Array.from(grid?.children ?? [])).toEqual(cards);
    expect(cards.every((card) => card.getAttribute("aria-pressed") === "false")).toBe(true);
    expect(screen.queryByText(inactiveUnassignedPropertySetting.name)).toBeNull();

    fireEvent.click(cards[0]);
    fireEvent.click(cards[2]);
    expect(cards[0].getAttribute("aria-pressed")).toBe("true");
    expect(cards[2].getAttribute("aria-pressed")).toBe("true");
  });

  it("saves create and edit selections as exact full-replacement ID payloads", async () => {
    window.history.replaceState({}, "", "?step=0");
    const { unmount } = render(<PropertyWizard mode="create" />);

    fireEvent.change(await screen.findByLabelText("نام فارسی"), {
      target: { value: "اقامتگاه آزمایشی" },
    });
    fireEvent.change(screen.getByLabelText("نام انگلیسی"), {
      target: { value: "Test Stay" },
    });
    fireEvent.click(screen.getByRole("button", { name: "ذخیره و ادامه" }));
    await screen.findByRole("heading", { name: "بافت و موقعیت محیطی" });
    fireEvent.click(screen.getByRole("button", { name: propertySettingCatalog[1].name }));
    fireEvent.click(screen.getByRole("button", { name: propertySettingCatalog[3].name }));
    fireEvent.click(screen.getByRole("button", { name: "ذخیره" }));

    await waitFor(() => {
      const call = api.request.mock.calls.find(
        ([path, init]) =>
          path === "/owner/properties/17/settings" && init?.method === "PUT",
      );
      expect(JSON.parse(String(call?.[1]?.body))).toEqual({
        propertySettingIds: [2, 4],
      });
    });

    unmount();
    api.request.mockClear();
    loadedAssignedPropertySettings = [
      propertySettingCatalog[0],
      propertySettingCatalog[2],
    ];
    window.history.replaceState({}, "", "?step=1");
    render(<PropertyWizard mode="edit" propertyId={17} />);

    const first = await screen.findByRole("button", {
      name: propertySettingCatalog[0].name,
    });
    const third = screen.getByRole("button", {
      name: propertySettingCatalog[2].name,
    });
    await waitFor(() => expect(first.getAttribute("aria-pressed")).toBe("true"));
    expect(third.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(first);
    fireEvent.click(screen.getByRole("button", { name: propertySettingCatalog[4].name }));
    fireEvent.click(screen.getByRole("button", { name: "ذخیره" }));

    await waitFor(() => {
      const call = api.request.mock.calls.find(
        ([path, init]) =>
          path === "/owner/properties/17/settings" && init?.method === "PUT",
      );
      expect(JSON.parse(String(call?.[1]?.body))).toEqual({
        propertySettingIds: [3, 5],
      });
    });
  });

  it("keeps an assigned inactive setting visible and removable without offering inactive unassigned settings", async () => {
    loadedPropertySettings = [
      ...propertySettingCatalog,
      inactiveUnassignedPropertySetting,
    ];
    loadedAssignedPropertySettings = [inactiveAssignedPropertySetting];
    window.history.replaceState({}, "", "?step=1");
    render(<PropertyWizard mode="edit" propertyId={17} />);

    const inactiveCard = await screen.findByRole("button", {
      name: new RegExp(inactiveAssignedPropertySetting.name),
    });
    expect(inactiveCard.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText("دیگر فعال نیست")).toBeTruthy();
    expect(screen.queryByText(inactiveUnassignedPropertySetting.name)).toBeNull();
    fireEvent.click(inactiveCard);
    expect(inactiveCard.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(inactiveCard);
    expect(inactiveCard.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(inactiveCard);
    fireEvent.click(screen.getByRole("button", { name: "ذخیره" }));

    await waitFor(() => {
      const call = api.request.mock.calls.find(
        ([path, init]) =>
          path === "/owner/properties/17/settings" && init?.method === "PUT",
      );
      expect(JSON.parse(String(call?.[1]?.body))).toEqual({
        propertySettingIds: [],
      });
      expect(screen.queryByText(inactiveAssignedPropertySetting.name)).toBeNull();
    });
  });

  it("preserves selection and reports an assignment save failure", async () => {
    propertySettingsPutError = new Error("ذخیره بافت و موقعیت انجام نشد.");
    window.history.replaceState({}, "", "?step=1");
    render(<PropertyWizard mode="edit" propertyId={17} />);

    const card = await screen.findByRole("button", {
      name: propertySettingCatalog[0].name,
    });
    fireEvent.click(card);
    fireEvent.click(screen.getByRole("button", { name: "ذخیره" }));

    expect(await screen.findByText("ذخیره بافت و موقعیت انجام نشد.")).toBeTruthy();
    expect(card.getAttribute("aria-pressed")).toBe("true");
  });

  it("keeps PropertySetting out of completion while Amenities alone complete their sidebar step", async () => {
    loadedAmenityCategories = [amenityCategory];
    loadedAmenities = [wifiAmenity];
    window.history.replaceState({}, "", "?step=1");
    render(<PropertyWizard mode="edit" propertyId={17} />);

    fireEvent.click(
      await screen.findByRole("button", { name: propertySettingCatalog[0].name }),
    );
    fireEvent.click(screen.getByRole("button", { name: /بازبینی/ }));
    expect(
      screen.getByRole("button", { name: /^امکانات/ }).textContent,
    ).toContain("ناقص");

    fireEvent.click(screen.getByRole("button", { name: /^امکانات/ }));
    fireEvent.click(
      await screen.findByRole("button", { name: wifiAmenity.name }),
    );
    fireEvent.click(screen.getByRole("button", { name: /بازبینی/ }));
    expect(
      screen.getByRole("button", { name: /^امکانات/ }).textContent,
    ).toContain("✓");
    expect(
      api.request.mock.calls.some(([path]) =>
        String(path).endsWith("/views"),
      ),
    ).toBe(false);
  });

  it("renders one compact authoritative completion summary on Review", async () => {
    window.history.replaceState({}, "", "?step=10");
    render(<PropertyWizard mode="edit" propertyId={17} />);

    expect(await screen.findByText("50% تکمیل شده")).toBeTruthy();
    expect(screen.getByText("اتاق‌های فعال")).toBeTruthy();
    expect(screen.getByText("قیمت‌گذاری اقامتگاه")).toBeTruthy();
    expect(screen.getByText("موجودی رزرو")).toBeTruthy();
    expect(screen.queryByText("وضعیت مالی آزمایشی")).toBeNull();
    expect(screen.getByText("1 بخش ناقص دیگر")).toBeTruthy();
    expect(screen.queryByText(/میزان تکمیل اطلاعات/)).toBeNull();
    expect(screen.queryByRole("heading", { name: "موارد ناقص" })).toBeNull();

    expect(screen.getByText("تنظیمات مالی کامل نشده")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "دسترسی" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "مشاهده صفحه عمومی" })).toBeTruthy();
  });

  it("renders ordered categories as one continuous amenity grid", async () => {
    loadedAmenityCategories = [
      amenityCategory,
      { ...bathroomCategory, id: 99, name: "Empty Category" },
      bathroomCategory,
    ];
    loadedAmenities = [wifiAmenity, showerAmenity];
    loadedPropertyAmenities = [];
    window.history.replaceState({}, "", "?step=3");
    const { container } = render(
      <PropertyWizard mode="edit" propertyId={17} />,
    );

    const wifiCard = await screen.findByRole("button", {
      name: wifiAmenity.name,
    });
    const showerCard = screen.getByRole("button", {
      name: showerAmenity.name,
    });
    const grids = container.querySelectorAll("[data-amenity-selection-grid]");
    expect(grids).toHaveLength(1);
    expect(grids[0]?.className).toContain("grid-cols-2");
    expect(Array.from(grids[0]?.children ?? [])).toEqual([
      wifiCard,
      showerCard,
    ]);
    expect(screen.queryByText(amenityCategory.name)).toBeNull();
    expect(screen.queryByText(bathroomCategory.name)).toBeNull();
    expect(screen.queryByText("Empty Category")).toBeNull();
    expect(screen.getAllByRole("button", { name: wifiAmenity.name })).toHaveLength(
      1,
    );
    expect(
      wifiCard.querySelector('[data-amenity-category-icon="decorative"]')
        ?.innerHTML,
    ).toContain(amenityCategory.icon);
    expect(
      showerCard.querySelector('[data-amenity-category-icon="decorative"]')
        ?.innerHTML,
    ).toContain(bathroomCategory.icon);

    fireEvent.click(wifiCard);
    fireEvent.click(showerCard);
    expect(wifiCard.getAttribute("aria-pressed")).toBe("true");
    expect(showerCard.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(wifiCard);
    expect(wifiCard.getAttribute("aria-pressed")).toBe("false");
    expect(showerCard.getAttribute("aria-pressed")).toBe("true");
  });

  it("uses the same continuous amenity grid in create mode", async () => {
    loadedAmenityCategories = [amenityCategory, bathroomCategory];
    loadedAmenities = [wifiAmenity, showerAmenity];
    window.history.replaceState({}, "", "?step=3");
    const { container } = render(<PropertyWizard mode="create" />);

    const grid = await waitFor(() => {
      const element = container.querySelector("[data-amenity-selection-grid]");
      expect(element).toBeTruthy();
      return element;
    });
    expect(grid?.children).toHaveLength(2);
    expect(screen.queryByText(amenityCategory.name)).toBeNull();
    expect(screen.queryByText(bathroomCategory.name)).toBeNull();
    expect(
      screen.getByRole("button", { name: wifiAmenity.name }).getAttribute(
        "aria-pressed",
      ),
    ).toBe("false");
    expect(
      screen.getByRole("button", { name: showerAmenity.name }).getAttribute(
        "aria-pressed",
      ),
    ).toBe("false");
  });

  it("does not expose the legacy inventory model while creating an accommodation", async () => {
    window.history.replaceState({}, "", "?step=0");
    render(<PropertyWizard mode="create" />);

    await screen.findByRole("heading", { name: "اطلاعات پایه" });
    expect(screen.queryByLabelText("مدل موجودی")).toBeNull();
    expect(screen.queryByRole("option", { name: "اتاق نام‌دار" })).toBeNull();
    expect(screen.getByLabelText("نوع اقامتگاه")).toBeTruthy();
  });

  it("preserves the stored city when editing an existing accommodation", async () => {
    window.history.replaceState({}, "", "?step=1");
    render(<PropertyWizard mode="edit" propertyId={17} />);

    const city = await screen.findByLabelText("شهر");
    await waitFor(() =>
      expect((city as HTMLInputElement).value).toBe("شیراز"),
    );
  });

  it("prefills a valid coordinate pair without saving on mount", async () => {
    loadedProperty = {
      ...property,
      latitude: 33.987654,
      longitude: 51.412345,
    };
    window.history.replaceState({}, "", "?step=1");
    render(<PropertyWizard mode="edit" propertyId={17} />);

    const picker = await screen.findByTestId("property-location-picker");
    await waitFor(() =>
      expect(picker.getAttribute("data-coordinates")).toBe(
        JSON.stringify({ latitude: 33.987654, longitude: 51.412345 }),
      ),
    );
    expect(
      api.request.mock.calls.some(
        ([path, init]) =>
          path === "/owner/properties/17/sections/location" &&
          init?.method === "PUT",
      ),
    ).toBe(false);
  });

  it("passes null coordinates to the edit picker", async () => {
    window.history.replaceState({}, "", "?step=1");
    render(<PropertyWizard mode="edit" propertyId={17} />);

    const picker = await screen.findByTestId("property-location-picker");
    expect(picker.getAttribute("data-coordinates")).toBe("null");
  });

  it("saves a selected owner location without changing city or address", async () => {
    window.history.replaceState({}, "", "?step=1");
    render(<PropertyWizard mode="edit" propertyId={17} />);

    const city = await screen.findByLabelText("شهر");
    const address = screen.getByLabelText("نشانی");
    fireEvent.click(screen.getByRole("button", { name: "انتخاب موقعیت آزمایشی" }));
    expect((city as HTMLInputElement).value).toBe("شیراز");
    expect((address as HTMLInputElement).value).toBe("نشانی");
    fireEvent.click(screen.getByRole("button", { name: "ذخیره" }));

    await waitFor(() => {
      const call = api.request.mock.calls.find(
        ([path, init]) =>
          path === "/owner/properties/17/sections/location" &&
          init?.method === "PUT",
      );
      const payload = JSON.parse(String(call?.[1]?.body));
      expect(payload).toMatchObject({
        address: "نشانی",
        city: "شیراز",
        latitude: 35.123456,
        longitude: 50.654321,
      });
    });
  });

  it("saves a cleared owner location as a null pair", async () => {
    loadedProperty = {
      ...property,
      latitude: 33.987654,
      longitude: 51.412345,
    };
    window.history.replaceState({}, "", "?step=1");
    render(<PropertyWizard mode="edit" propertyId={17} />);

    await screen.findByTestId("property-location-picker");
    fireEvent.click(screen.getByRole("button", { name: "پاک کردن موقعیت" }));
    fireEvent.click(screen.getByRole("button", { name: "ذخیره" }));

    await waitFor(() => {
      const call = api.request.mock.calls.find(
        ([path, init]) =>
          path === "/owner/properties/17/sections/location" &&
          init?.method === "PUT",
      );
      const payload = JSON.parse(String(call?.[1]?.body));
      expect(payload.latitude).toBeNull();
      expect(payload.longitude).toBeNull();
    });
  });

  it("uses the existing admin location endpoint for admin edit", async () => {
    loadedProperty = {
      ...property,
      latitude: 33.987654,
      longitude: 51.412345,
    };
    window.history.replaceState({}, "", "?step=1");
    render(<PropertyWizard isAdmin mode="edit" propertyId={17} />);

    const picker = await screen.findByTestId("property-location-picker");
    await waitFor(() =>
      expect(picker.getAttribute("data-coordinates")).toBe(
        JSON.stringify({ latitude: 33.987654, longitude: 51.412345 }),
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "انتخاب موقعیت آزمایشی" }));
    fireEvent.click(screen.getByRole("button", { name: "ذخیره" }));

    await waitFor(() => {
      const call = api.request.mock.calls.find(
        ([path, init]) =>
          path === "/admin/properties/17/sections/location" &&
          init?.method === "PUT",
      );
      const payload = JSON.parse(String(call?.[1]?.body));
      expect(payload).toMatchObject({
        latitude: 35.123456,
        longitude: 50.654321,
      });
    });
  });

  it("keeps only the established uploader in the media step", async () => {
    window.history.replaceState({}, "", "?step=4");
    render(<PropertyWizard mode="edit" propertyId={17} />);

    expect(await screen.findByTestId("property-image-manager")).toBeTruthy();
    expect(screen.queryByText("افزودن تصویر با نشانی")).toBeNull();
    expect(screen.queryByPlaceholderText("نشانی تصویر")).toBeNull();
  });

  it("creates, updates and deletes common areas through one collection replacement", async () => {
    window.history.replaceState({}, "", "?step=5");
    render(<PropertyWizard mode="edit" propertyId={17} />);

    await screen.findByRole("heading", { name: "توضیحات و فضاها" });
    fireEvent.change(screen.getByDisplayValue("حیاط"), { target: { value: " حیاط مرکزی " } });
    fireEvent.click(screen.getAllByRole("button", { name: "حذف" })[1]);
    fireEvent.click(screen.getByRole("button", { name: "افزودن فضای مشترک" }));

    const emptyNameInput = screen.getAllByPlaceholderText("حیاط مرکزی").at(-1)!;
    fireEvent.change(emptyNameInput, { target: { value: " ایوان " } });
    fireEvent.click(screen.getByRole("button", { name: "ذخیره" }));

    await waitFor(() => expect(api.replaceCommonAreas).toHaveBeenCalledWith(17, [
      { name: "حیاط مرکزی", description: "کنار حوض", sortOrder: 1 },
      { name: "ایوان", description: null, sortOrder: 2 },
    ]));
    expect(api.replaceCommonAreas).toHaveBeenCalledOnce();
  });

  it("always identifies the active currency without showing the financial warning early", async () => {
    window.history.replaceState({}, "", "?step=0");
    render(<PropertyWizard mode="edit" propertyId={17} />);

    expect(await screen.findByText(/واحد پول:/)).toBeTruthy();
    expect(screen.queryByText("تنظیمات مالی کامل نشده")).toBeNull();
  });

  it("shows the financial warning only on final review when settings are incomplete", async () => {
    window.history.replaceState({}, "", "?step=10");
    render(<PropertyWizard mode="edit" propertyId={17} />);

    expect(await screen.findByText("تنظیمات مالی کامل نشده")).toBeTruthy();
  });

  it("formats financial inputs in Persian while sending separator-free numbers", async () => {
    window.history.replaceState({}, "", "?step=8");
    render(<PropertyWizard mode="edit" propertyId={17} />);

    const childPrice = await screen.findByLabelText(/نرخ کودک/);
    const extraGuestPrice = screen.getByLabelText(/نرخ نفر اضافه/);
    fireEvent.change(childPrice, { target: { value: "۱٬۲۳۴٬۵۶۷" } });
    fireEvent.change(extraGuestPrice, { target: { value: "۲٬۰۰۰٬۰۰۰" } });

    expect((childPrice as HTMLInputElement).value).toBe("۱٬۲۳۴٬۵۶۷");
    expect((extraGuestPrice as HTMLInputElement).value).toBe("۲٬۰۰۰٬۰۰۰");
    fireEvent.click(screen.getByRole("button", { name: "ذخیره" }));

    await waitFor(() => {
      const call = api.request.mock.calls.find(
        ([path, init]) => path === "/owner/properties/17/sections/financial" && init?.method === "PUT",
      );
      const payload = JSON.parse(String(call?.[1]?.body));
      expect(payload).toMatchObject({
        childPrice: 1_234_567,
        extraGuestPrice: 2_000_000,
      });
    });
  });
});
