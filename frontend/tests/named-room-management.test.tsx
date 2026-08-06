import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RoomTypeResponse } from "@/lib/owner-api";

const ownerApi = vi.hoisted(() => ({ apiRequest: vi.fn() }));
const notifications = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));

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

function arrangeApi(initialRoomTypes: RoomTypeResponse[] = []) {
  let roomTypes = [...initialRoomTypes];
  ownerApi.apiRequest.mockImplementation(
    async (path: string, init?: RequestInit) => {
      if (path === "/bed-types" || path === "/amenities") return [];
      if (path === "/catalogs/room-kinds") return roomKinds;
      if (path === "/owner/properties/3/images") return [];
      if (
        path === "/owner/properties/3/room-types" &&
        init?.method === "POST"
      ) {
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
          totalInventory: Number(payload.totalInventory),
          isActive: Boolean(payload.isActive),
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
  fireEvent.click(within(dialog).getByRole("button", { name: "بعدی" }));
  fireEvent.click(within(dialog).getByRole("button", { name: "بعدی" }));
  fireEvent.click(within(dialog).getByRole("button", { name: "بعدی" }));
  fireEvent.click(
    within(dialog).getByRole("button", { name: "ذخیره و ادامه به تصاویر" }),
  );
}

describe("unified owner sellable room type management", () => {
  beforeEach(() => vi.clearAllMocks());

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

    fireEvent.click(within(dialog).getByRole("button", { name: "بعدی" }));
    expect(notifications.error).toHaveBeenCalledWith(
      "نام نوع اتاق الزامی است.",
    );

    await fillRequiredFields(dialog, "-1");
    fireEvent.click(within(dialog).getByRole("button", { name: "بعدی" }));
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
      await within(dialog).findByText("مدیریت تصاویر نوع اتاق"),
    ).toBeTruthy();
    expect(await screen.findByText("دابل دلوکس")).toBeTruthy();
  });

  it("edits the existing sellable RoomType rather than creating an internal template", async () => {
    arrangeApi([zanbagh]);
    render(<RoomManagement propertyId={3} />);
    fireEvent.click(await screen.findByRole("button", { name: "ویرایش" }));
    const dialog = await screen.findByRole("dialog");

    expect(
      (within(dialog).getByLabelText(/نام نوع اتاق/) as HTMLInputElement).value,
    ).toBe("زنبق");
    expect(
      (within(dialog).getByLabelText(/تعداد واحد قابل فروش/) as HTMLInputElement)
        .value,
    ).toBe("0");
    expect(within(dialog).getByText("ویرایش نوع اتاق")).toBeTruthy();
  });
});
