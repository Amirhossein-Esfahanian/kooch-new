import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

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
    workspaces: ["owner"],
  }),
}));

vi.mock("@/components/owner/PropertyImageManager", () => ({
  PropertyImageManager: () => <div data-testid="property-image-manager">مدیریت تصاویر</div>,
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

const property = {
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
  city: "کاشان",
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

describe("PropertyWizard media and common areas", () => {
  beforeEach(() => {
    api.request.mockReset();
    api.replaceCommonAreas.mockReset();
    api.request.mockImplementation((path: string, init?: RequestInit) => {
      if (path === "/amenity-categories" || path === "/amenities") return Promise.resolve([]);
      if (path === "/owner/properties/17") return Promise.resolve(property);
      if (path === "/owner/properties/17/completion") return Promise.resolve(completion);
      if (path === "/owner/properties/17/descriptions") {
        return init?.method === "POST"
          ? Promise.resolve({ id: 10, propertyId: 17, sectionType: "PropertyIntroduction", title: "معرفی اقامتگاه", content: "معرفی اقامتگاه", sortOrder: 1 })
          : Promise.resolve([]);
      }
      if (path === "/owner/properties/17/images") return Promise.resolve([]);
      if (path === "/owner/properties/17/amenities") return Promise.resolve([]);
      if (path === "/owner/properties/17/common-areas") return Promise.resolve(existingCommonAreas);
      if (path === "/owner/properties/17/nearby-places") return Promise.resolve([]);
      if (path === "/owner/properties/17/views") return Promise.resolve([]);
      if (path === "/owner/properties/17/room-types") return Promise.resolve([]);
      if (path === "/owner/properties/17/sections/description") return Promise.resolve(property);
      throw new Error(`Unexpected API request: ${path}`);
    });
    api.replaceCommonAreas.mockResolvedValue([
      { id: 3, propertyId: 17, name: "حیاط مرکزی", description: "کنار حوض", sortOrder: 1 },
      { id: 4, propertyId: 17, name: "ایوان", description: null, sortOrder: 2 },
    ]);
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
});
