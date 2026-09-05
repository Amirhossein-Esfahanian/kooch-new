import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AmenityCategoryResponse,
  AmenityResponse,
  BedTypeResponse,
  RoomTypeResponse,
} from "@/lib/owner-api";

const ownerApi = vi.hoisted(() => ({ apiRequest: vi.fn() }));
const notifications = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));
let roomTypeSaveError: Error | null = null;

vi.mock("@/lib/owner-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/owner-api")>();
  return { ...actual, apiRequest: ownerApi.apiRequest };
});

vi.mock("sonner", () => ({ toast: notifications }));
vi.mock("@/components/owner/PropertyImageManager", () => ({
  PropertyImageManager: () => <div>مدیریت تصاویر نوع اتاق</div>,
}));

import { RoomManagement } from "@/components/owner/RoomManagement";

const roomKinds = [
  {
    value: 2,
    code: "double",
    titleFa: "دابل",
    titleEn: "Double",
    displayOrder: 20,
  },
  {
    value: 3,
    code: "twin",
    titleFa: "تویین",
    titleEn: "Twin",
    displayOrder: 30,
  },
];

const bedTypes: BedTypeResponse[] = [
  { id: 1, name: "Single Bed", slug: "single-bed", icon: null },
  { id: 2, name: "Double Bed", slug: "double-bed", icon: null },
  { id: 3, name: "Queen Bed", slug: "queen-bed", icon: null },
  { id: 4, name: "King Bed", slug: "king-bed", icon: null },
  { id: 5, name: "Twin Beds", slug: "twin-beds", icon: null },
  { id: 6, name: "Sofa Bed", slug: "sofa-bed", icon: null },
  {
    id: 7,
    name: "Traditional Floor Bedding",
    slug: "traditional-floor-bedding",
    icon: null,
  },
];

const zanbagh: RoomTypeResponse = {
  id: 4,
  propertyId: 3,
  name: "زنبق",
  englishName: null,
  slug: "room-type-4",
  description: "اتاق زنبق",
  maxAdults: 2,
  maxChildren: 0,
  allowExtraGuest: false,
  maxExtraGuests: 0,
  totalInventory: 0,
  activeRoomCount: 0,
  inventoryMode: "TypeBasedInventory",
  roomKind: "Double",
  roomKindCode: "double",
  basePrice: 2_500_000,
  notes: null,
  floorNumber: null,
  stairCount: null,
  hasWindow: true,
  hasPrivateBathroom: true,
  isActive: false,
  completion: {
    isComplete: false,
    missingItems: ["تعداد موجودی"],
    sections: [],
  },
  bedConfigurations: [],
  amenities: [],
};

function arrangeApi(
  initialRoomTypes: RoomTypeResponse[] = [],
  amenityFixtures: {
    categories?: AmenityCategoryResponse[];
    amenities?: AmenityResponse[];
    bedTypes?: BedTypeResponse[];
  } = {},
) {
  let roomTypes = [...initialRoomTypes];
  ownerApi.apiRequest.mockImplementation(
    async (path: string, init?: RequestInit) => {
      if (path === "/bed-types") return amenityFixtures.bedTypes ?? [];
      if (path === "/amenity-categories")
        return amenityFixtures.categories ?? [];
      if (path === "/amenities") return amenityFixtures.amenities ?? [];
      if (path === "/catalogs/room-kinds") return roomKinds;
      if (path === "/owner/properties/3/images") return [];
      if (
        path === "/owner/properties/3/room-types" &&
        init?.method === "POST"
      ) {
        if (roomTypeSaveError) throw roomTypeSaveError;
        const payload = JSON.parse(String(init.body)) as Record<
          string,
          unknown
        >;
        const created: RoomTypeResponse = {
          ...zanbagh,
          id: 10,
          name: String(payload.name),
          description: String(payload.description),
          totalInventory: Number(payload.totalInventory),
          roomKind: payload.roomKind === 3 ? "Twin" : "Double",
          roomKindCode: payload.roomKind === 3 ? "twin" : "double",
        };
        roomTypes = [...roomTypes, created];
        return created;
      }
      if (path.startsWith("/owner/room-types/") && init?.method === "PUT") {
        if (roomTypeSaveError) throw roomTypeSaveError;
        const payload = JSON.parse(String(init.body)) as Record<
          string,
          unknown
        >;
        const existing =
          roomTypes.find((roomType) => path.endsWith(String(roomType.id))) ??
          zanbagh;
        const updated: RoomTypeResponse = {
          ...existing,
          name: String(payload.name),
          englishName:
            payload.englishName == null ? null : String(payload.englishName),
          description: String(payload.description),
          notes: payload.notes == null ? null : String(payload.notes),
          floorNumber:
            payload.floorNumber == null ? null : Number(payload.floorNumber),
          stairCount:
            payload.stairCount == null ? null : Number(payload.stairCount),
          hasWindow:
            payload.hasWindow == null ? null : Boolean(payload.hasWindow),
          hasPrivateBathroom:
            payload.hasPrivateBathroom == null
              ? null
              : Boolean(payload.hasPrivateBathroom),
          maxAdults: Number(payload.maxAdults),
          maxChildren: Number(payload.maxChildren),
          allowExtraGuest: Boolean(payload.allowExtraGuest),
          maxExtraGuests: Number(payload.maxExtraGuests),
          totalInventory: Number(payload.totalInventory),
          isActive: Boolean(payload.isActive),
          bedConfigurations: (
            (payload.bedConfigurations as {
              bedTypeId: number;
              quantity: number;
            }[]) ?? []
          ).flatMap((bed) => {
            const bedType = amenityFixtures.bedTypes?.find(
              (item) => item.id === bed.bedTypeId,
            );
            return bedType
              ? [
                  {
                    bedTypeId: bedType.id,
                    bedTypeName: bedType.name,
                    bedTypeSlug: bedType.slug,
                    quantity: bed.quantity,
                  },
                ]
              : [];
          }),
          amenities: ((payload.amenityIds as number[]) ?? []).flatMap((id) => {
            const amenity = amenityFixtures.amenities?.find(
              (item) => item.id === id,
            );
            return amenity
              ? [
                  {
                    amenityId: amenity.id,
                    name: amenity.name,
                    amenityCategoryId: amenity.amenityCategoryId,
                    categoryName: amenity.categoryName,
                  },
                ]
              : [];
          }),
        };
        roomTypes = roomTypes.map((roomType) =>
          roomType.id === updated.id ? updated : roomType,
        );
        return updated;
      }
      if (path === "/owner/properties/3/room-types") return roomTypes;
      throw new Error(`Unexpected API request: ${path}`);
    },
  );
}

async function openCreateDialog() {
  fireEvent.click(
    await screen.findByRole("button", { name: "افزودن نوع اتاق" }),
  );
  return screen.findByRole("dialog");
}

async function fillRequiredFields(dialog: HTMLElement, inventory = "2") {
  fireEvent.change(within(dialog).getByLabelText(/نام نوع اتاق/), {
    target: { value: "دابل دلوکس" },
  });
  fireEvent.change(within(dialog).getByLabelText(/نوع استاندارد اتاق/), {
    target: { value: "double" },
  });
  fireEvent.change(within(dialog).getByLabelText(/تعداد واحد قابل فروش/), {
    target: { value: inventory },
  });
  fireEvent.change(within(dialog).getByLabelText(/ظرفیت بزرگسال/), {
    target: { value: "2" },
  });
}

async function saveFromWizard(dialog: HTMLElement) {
  expect(
    within(dialog).getByRole("button", { name: "ذخیره و خروج" }),
  ).toBeTruthy();
  await continueTo(dialog, "ویژگی‌های نوع اتاق");
  expect(
    within(dialog).getByRole("button", { name: "ذخیره و خروج" }),
  ).toBeTruthy();
  await continueTo(dialog, "امکانات");
  expect(
    within(dialog).getByRole("button", { name: "ذخیره و خروج" }),
  ).toBeTruthy();
  await continueTo(dialog, "تخت‌ها و چیدمان");
  expect(
    within(dialog).getByRole("button", { name: "ذخیره و خروج" }),
  ).toBeTruthy();
  await continueTo(dialog, "تصاویر نوع اتاق");
  expect(
    within(dialog).getByRole("button", { name: "ذخیره و خروج" }),
  ).toBeTruthy();
}

async function continueTo(dialog: HTMLElement, heading: string) {
  fireEvent.click(within(dialog).getByRole("button", { name: "ادامه" }));
  await waitFor(() => {
    expect(within(dialog).getByRole("heading", { name: heading })).toBeTruthy();
  });
}

async function continueToBeds(dialog: HTMLElement) {
  await continueTo(dialog, "ویژگی‌های نوع اتاق");
  await continueTo(dialog, "امکانات");
  await continueTo(dialog, "تخت‌ها و چیدمان");
}

describe("unified owner sellable room type management", () => {
  beforeEach(() => {
    roomTypeSaveError = null;
    vi.clearAllMocks();
  });

  it("shows sellable RoomTypes and keeps physical-room and InventoryMode concepts out of the main UI", async () => {
    arrangeApi([zanbagh]);
    render(<RoomManagement propertyId={3} />);

    expect(await screen.findByText("زنبق")).toBeTruthy();
    expect(screen.getByText("دابل")).toBeTruthy();
    expect(screen.getByText("موجودی فروش صفر است")).toBeTruthy();
    expect(screen.queryByText(/شیوه مدیریت موجودی/)).toBeNull();
    expect(screen.queryByText(/اتاق‌های نام‌دار/)).toBeNull();
    expect(screen.queryByText(/Double-1/)).toBeNull();
    expect(screen.getByRole("button", { name: "ویرایش" })).toBeTruthy();
  });

  it("uses the compact Admin header treatment without the redundant intro card", async () => {
    arrangeApi([zanbagh]);
    render(<RoomManagement compactHeader propertyId={3} />);

    expect(await screen.findByText("زنبق")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "افزودن نوع اتاق" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("heading", { name: "نوع‌های اتاق ثبت‌شده" }),
    ).toBeTruthy();
    expect(
      screen.queryByRole("heading", { name: "مدیریت نوع‌های اتاق" }),
    ).toBeNull();
    const registeredRoomTypesCard = screen
      .getByRole("heading", { name: "نوع‌های اتاق ثبت‌شده" })
      .closest("section");
    expect(
      registeredRoomTypesCard?.querySelector("button")?.textContent,
    ).toBe("افزودن نوع اتاق");
  });

  it("loads RoomKind from the catalog and defaults TotalInventory to zero", async () => {
    arrangeApi();
    render(<RoomManagement propertyId={3} />);
    const dialog = await openCreateDialog();

    expect(within(dialog).getByRole("option", { name: "دابل" })).toBeTruthy();
    expect(
      (within(dialog).getByLabelText(/تعداد واحد قابل فروش/) as HTMLInputElement)
        .value,
    ).toBe("0");
    expect(
      (within(dialog).getByLabelText(/ظرفیت بزرگسال/) as HTMLInputElement).value,
    ).toBe("0");
    expect(within(dialog).queryByLabelText(/قیمت پایه/)).toBeNull();
    expect(within(dialog).queryByLabelText(/شیوه مدیریت موجودی/)).toBeNull();
  });

  it("uses simple step titles and places the close control opposite the RTL title", async () => {
    arrangeApi();
    render(<RoomManagement propertyId={3} />);
    const dialog = await openCreateDialog();

    for (const title of ["اطلاعات کلی", "ظرفیت", "امکانات", "تخت‌ها", "تصاویر"]) {
      expect(within(dialog).getByRole("button", { name: title })).toBeTruthy();
    }
    expect(within(dialog).queryByRole("button", { name: /۱[.-]/ })).toBeNull();
    expect(within(dialog).getByRole("button", { name: "بستن" }).className).toContain("left-4");
  });

  it("requires a sellable name and rejects negative inventory", async () => {
    arrangeApi();
    render(<RoomManagement propertyId={3} />);
    const dialog = await openCreateDialog();

    fireEvent.click(within(dialog).getByRole("button", { name: "ادامه" }));
    expect(notifications.error).toHaveBeenCalledWith(
      "نام نوع اتاق الزامی است.",
    );

    await fillRequiredFields(dialog, "-1");
    fireEvent.click(within(dialog).getByRole("button", { name: "ادامه" }));
    expect(notifications.error).toHaveBeenCalledWith(
      "تعداد واحد قابل فروش نمی‌تواند منفی باشد.",
    );
    expect(
      ownerApi.apiRequest.mock.calls.some(
        ([, init]) => init?.method === "POST",
      ),
    ).toBe(false);
  });

  it("creates a RoomType with the owner name and multiple inventory without sending InventoryMode", async () => {
    arrangeApi();
    render(<RoomManagement propertyId={3} />);
    const dialog = await openCreateDialog();
    await fillRequiredFields(dialog, "3");
    await saveFromWizard(dialog);

    await waitFor(() => {
      expect(ownerApi.apiRequest).toHaveBeenCalledWith(
        "/owner/properties/3/room-types",
        expect.objectContaining({ method: "POST" }),
      );
    });
    const call = ownerApi.apiRequest.mock.calls.find(
      ([path, init]) =>
        path === "/owner/properties/3/room-types" && init?.method === "POST",
    );
    const payload = JSON.parse(String(call?.[1]?.body));
    expect(payload).toMatchObject({
      name: "دابل دلوکس",
      roomKind: 2,
      totalInventory: 3,
    });
    expect(payload).not.toHaveProperty("inventoryMode");
    expect(payload).not.toHaveProperty("propertyId");
    expect(payload).not.toHaveProperty("basePrice");
    expect(
      ownerApi.apiRequest.mock.calls.filter(
        ([path, init]) =>
          path === "/owner/properties/3/room-types" && init?.method === "POST",
      ),
    ).toHaveLength(1);
    expect(
      ownerApi.apiRequest.mock.calls.filter(
        ([path, init]) =>
          path === "/owner/room-types/10" && init?.method === "PUT",
      ),
    ).toHaveLength(3);
    expect(
      await within(dialog).findByText("مدیریت تصاویر نوع اتاق"),
    ).toBeTruthy();
    expect(await screen.findByText("دابل دلوکس")).toBeTruthy();
  });

  it("toggles the shared amenity card and preserves the room amenity ID payload", async () => {
    const category: AmenityCategoryResponse = {
      id: 2,
      name: "خدمات پایه",
      slug: "base-services",
      sortOrder: 1,
      icon: "/svgs/amenity-categories/base-services.svg",
      isActive: true,
    };
    const amenity: AmenityResponse = {
      id: 7,
      amenityCategoryId: category.id,
      categoryName: category.name,
      categorySlug: category.slug,
      categorySortOrder: category.sortOrder,
      name: "اینترنت بی‌سیم",
      slug: "wifi",
      description: null,
      icon: "/svgs/amenities/wifi.svg",
      scope: "Both",
      sortOrder: 1,
    };
    arrangeApi([], { categories: [category], amenities: [amenity] });
    render(<RoomManagement propertyId={3} />);
    const dialog = await openCreateDialog();
    await fillRequiredFields(dialog, "2");

    await continueTo(dialog, "ویژگی‌های نوع اتاق");
    await continueTo(dialog, "امکانات");

    const card = within(dialog).getByRole("button", { name: amenity.name });
    expect(card.getAttribute("aria-pressed")).toBe("false");
    expect(within(card).queryByRole("checkbox")).toBeNull();
    fireEvent.click(card);
    expect(card.getAttribute("aria-pressed")).toBe("true");

    await continueTo(dialog, "تخت‌ها و چیدمان");
    await continueTo(dialog, "تصاویر نوع اتاق");

    await waitFor(() => {
      const call = [...ownerApi.apiRequest.mock.calls].reverse().find(
        ([path, init]) =>
          path === "/owner/room-types/10" && init?.method === "PUT",
      );
      expect(JSON.parse(String(call?.[1]?.body)).amenityIds).toEqual([
        amenity.id,
      ]);
    });
    expect(ownerApi.apiRequest).toHaveBeenCalledWith("/amenity-categories");
  });

  it("updates a legacy RoomType from one to multiple sellable units without legacy validation", async () => {
    arrangeApi([{ ...zanbagh, totalInventory: 1 }]);
    render(<RoomManagement propertyId={3} />);
    fireEvent.click(await screen.findByRole("button", { name: "ویرایش" }));
    const dialog = await screen.findByRole("dialog");

    expect(
      (within(dialog).getByLabelText(/نام نوع اتاق/) as HTMLInputElement).value,
    ).toBe("زنبق");
    expect(
      (within(dialog).getByLabelText(/تعداد واحد قابل فروش/) as HTMLInputElement)
        .value,
    ).toBe("1");
    expect(within(dialog).getByText("ویرایش نوع اتاق")).toBeTruthy();

    fireEvent.change(within(dialog).getByLabelText(/تعداد واحد قابل فروش/), {
      target: { value: "10" },
    });
    await saveFromWizard(dialog);

    await waitFor(() => {
      expect(ownerApi.apiRequest).toHaveBeenCalledWith(
        "/owner/room-types/4",
        expect.objectContaining({ method: "PUT" }),
      );
    });
    const call = ownerApi.apiRequest.mock.calls.find(
      ([path, init]) => path === "/owner/room-types/4" && init?.method === "PUT",
    );
    expect(JSON.parse(String(call?.[1]?.body))).toMatchObject({
      name: "زنبق",
      totalInventory: 10,
    });
    expect(notifications.error).not.toHaveBeenCalledWith(
      "تعداد واحد قابل فروش نمی‌تواند منفی باشد.",
    );
    expect(
      ownerApi.apiRequest.mock.calls.some(
        ([path, init]) =>
          path === "/owner/properties/3/room-types" && init?.method === "POST",
      ),
    ).toBe(false);
  });

  it("saves before advancing and remains on the current step when saving fails", async () => {
    arrangeApi();
    render(<RoomManagement propertyId={3} />);
    const dialog = await openCreateDialog();
    await fillRequiredFields(dialog);
    roomTypeSaveError = new Error("ذخیره آزمایشی انجام نشد.");

    fireEvent.click(within(dialog).getByRole("button", { name: "ادامه" }));

    expect(await within(dialog).findByText("ذخیره آزمایشی انجام نشد.")).toBeTruthy();
    expect(
      within(dialog).getByRole("heading", { name: "اطلاعات کلی" }),
    ).toBeTruthy();
    expect(
      within(dialog).queryByRole("heading", { name: "ویژگی‌های نوع اتاق" }),
    ).toBeNull();

    roomTypeSaveError = null;
    await continueTo(dialog, "ویژگی‌های نوع اتاق");
    expect(
      ownerApi.apiRequest.mock.calls.filter(
        ([path, init]) =>
          path === "/owner/properties/3/room-types" && init?.method === "POST",
      ),
    ).toHaveLength(2);
  });

  it("saves and exits from Create, but stays open when Save & Exit fails", async () => {
    arrangeApi();
    render(<RoomManagement propertyId={3} />);
    const dialog = await openCreateDialog();
    await fillRequiredFields(dialog);
    roomTypeSaveError = new Error("خروج بدون ذخیره مجاز نیست.");

    fireEvent.click(
      within(dialog).getByRole("button", { name: "ذخیره و خروج" }),
    );
    expect(await within(dialog).findByText("خروج بدون ذخیره مجاز نیست.")).toBeTruthy();
    expect(screen.getByRole("dialog")).toBeTruthy();

    roomTypeSaveError = null;
    fireEvent.click(
      within(dialog).getByRole("button", { name: "ذخیره و خروج" }),
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(
      ownerApi.apiRequest.mock.calls.filter(
        ([path, init]) =>
          path === "/owner/properties/3/room-types" && init?.method === "POST",
      ),
    ).toHaveLength(2);
  });

  it("saves the current draft before moving to the previous step", async () => {
    arrangeApi();
    render(<RoomManagement propertyId={3} />);
    const dialog = await openCreateDialog();
    await fillRequiredFields(dialog);
    await continueTo(dialog, "ویژگی‌های نوع اتاق");
    fireEvent.change(within(dialog).getByLabelText("طبقه"), {
      target: { value: "2" },
    });

    fireEvent.click(
      within(dialog).getByRole("button", { name: "مرحله قبل" }),
    );

    await waitFor(() => {
      expect(
        within(dialog).getByRole("heading", { name: "اطلاعات کلی" }),
      ).toBeTruthy();
    });
    const updateCall = ownerApi.apiRequest.mock.calls.find(
      ([path, init]) => path === "/owner/room-types/10" && init?.method === "PUT",
    );
    expect(JSON.parse(String(updateCall?.[1]?.body)).floorNumber).toBe(2);
    expect(
      ownerApi.apiRequest.mock.calls.filter(
        ([path, init]) =>
          path === "/owner/properties/3/room-types" && init?.method === "POST",
      ),
    ).toHaveLength(1);
  });

  it("renders every supported bed type and updates quantities independently", async () => {
    arrangeApi([], { bedTypes });
    render(<RoomManagement propertyId={3} />);
    const dialog = await openCreateDialog();
    await fillRequiredFields(dialog);
    await continueToBeds(dialog);

    const grid = dialog.querySelector("[data-bed-selector-grid]");
    expect(grid?.className).toContain("sm:grid-cols-2");
    for (const label of [
      "تخت یک‌نفره",
      "تخت دابل",
      "تخت کویین",
      "تخت کینگ",
      "تخت تویین",
      "مبل تخت‌خواب‌شو",
      "رختخواب سنتی",
    ]) {
      expect(within(dialog).getByText(label)).toBeTruthy();
      expect(within(dialog).getByLabelText(`تعداد ${label}: 0`)).toBeTruthy();
      expect(
        (within(dialog).getByRole("button", {
          name: `کاهش تعداد ${label}`,
        }) as HTMLButtonElement).disabled,
      ).toBe(true);
    }

    fireEvent.click(
      within(dialog).getByRole("button", {
        name: "افزایش تعداد تخت یک‌نفره",
      }),
    );
    fireEvent.click(
      within(dialog).getByRole("button", {
        name: "افزایش تعداد تخت یک‌نفره",
      }),
    );
    fireEvent.click(
      within(dialog).getByRole("button", { name: "افزایش تعداد تخت دابل" }),
    );
    fireEvent.click(
      within(dialog).getByRole("button", { name: "کاهش تعداد تخت یک‌نفره" }),
    );

    expect(
      within(dialog).getByLabelText("تعداد تخت یک‌نفره: 1"),
    ).toBeTruthy();
    expect(within(dialog).getByLabelText("تعداد تخت دابل: 1")).toBeTruthy();
    expect(within(dialog).getByLabelText("تعداد تخت کویین: 0")).toBeTruthy();
  });

  it("uses a BedType SVG icon when present and the generic fallback otherwise", async () => {
    arrangeApi([], {
      bedTypes: [
        {
          ...bedTypes[0],
          icon: "/uploads/bed-types/1/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.svg",
        },
        bedTypes[1],
      ],
    });
    render(<RoomManagement propertyId={3} />);
    const dialog = await openCreateDialog();
    await fillRequiredFields(dialog);
    await continueToBeds(dialog);

    const uploadedRow = dialog.querySelector('[data-bed-type="single-bed"]');
    const fallbackRow = dialog.querySelector('[data-bed-type="double-bed"]');
    expect(uploadedRow?.querySelector('[data-bed-icon="uploaded"]')).toBeTruthy();
    expect(uploadedRow?.innerHTML).toContain(
      "/uploads/bed-types/1/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.svg",
    );
    expect(fallbackRow?.querySelector('[data-bed-icon="uploaded"]')).toBeNull();
    expect(fallbackRow?.innerHTML).toContain("/svgs/bed-bunk.svg");
  });

  it("restores persisted bed quantities and saves one non-zero entry per type", async () => {
    const roomWithBeds: RoomTypeResponse = {
      ...zanbagh,
      bedConfigurations: [
        {
          bedTypeId: 1,
          bedTypeName: "Single Bed",
          bedTypeSlug: "single-bed",
          quantity: 2,
        },
        {
          bedTypeId: 6,
          bedTypeName: "Sofa Bed",
          bedTypeSlug: "sofa-bed",
          quantity: 1,
        },
      ],
    };
    arrangeApi([roomWithBeds], { bedTypes });
    render(<RoomManagement propertyId={3} />);
    fireEvent.click(await screen.findByRole("button", { name: "ویرایش" }));
    const dialog = await screen.findByRole("dialog");
    await continueToBeds(dialog);

    expect(
      within(dialog).getByLabelText("تعداد تخت یک‌نفره: 2"),
    ).toBeTruthy();
    expect(
      within(dialog).getByLabelText("تعداد مبل تخت‌خواب‌شو: 1"),
    ).toBeTruthy();

    fireEvent.click(
      within(dialog).getByRole("button", { name: "کاهش تعداد تخت یک‌نفره" }),
    );
    fireEvent.click(
      within(dialog).getByRole("button", { name: "افزایش تعداد تخت کویین" }),
    );
    fireEvent.click(
      within(dialog).getByRole("button", { name: "افزایش تعداد تخت کویین" }),
    );
    fireEvent.click(
      within(dialog).getByRole("button", { name: "کاهش تعداد مبل تخت‌خواب‌شو" }),
    );
    fireEvent.click(
      within(dialog).getByRole("button", { name: "ذخیره و خروج" }),
    );

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    const saveCall = [...ownerApi.apiRequest.mock.calls].reverse().find(
      ([path, init]) => path === "/owner/room-types/4" && init?.method === "PUT",
    );
    const payload = JSON.parse(String(saveCall?.[1]?.body));
    expect(payload.bedConfigurations).toEqual([
      { bedTypeId: 1, quantity: 1 },
      { bedTypeId: 3, quantity: 2 },
    ]);
    expect(
      new Set(
        payload.bedConfigurations.map(
          (bed: { bedTypeId: number }) => bed.bedTypeId,
        ),
      ).size,
    ).toBe(payload.bedConfigurations.length);
  });
});
