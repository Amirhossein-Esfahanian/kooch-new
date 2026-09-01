import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PropertyResponse } from "@/lib/owner-api";

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
  sections: [],
  warnings: [],
  completedSections: [],
  missingSections: [],
  canActivate: false,
};

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

describe("PropertyWizard media and common areas", () => {
  beforeEach(() => {
    loadedProperty = property;
    loadedAmenityCategories = [];
    loadedAmenities = [];
    loadedPropertyAmenities = [];
    api.request.mockReset();
    api.replaceCommonAreas.mockReset();
    api.request.mockImplementation((path: string, init?: RequestInit) => {
      if (path === "/amenity-categories") return Promise.resolve(loadedAmenityCategories);
      if (path === "/amenities") return Promise.resolve(loadedAmenities);
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
      if (path === "/owner/properties/17/views") return Promise.resolve([]);
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
