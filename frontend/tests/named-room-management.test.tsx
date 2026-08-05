import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RoomResponse, RoomTypeResponse } from "@/lib/owner-api";

const ownerApi = vi.hoisted(() => ({
  apiRequest: vi.fn(),
}));

const notifications = vi.hoisted(() => ({
  error: vi.fn(),
  success: vi.fn(),
}));

vi.mock("@/lib/owner-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/owner-api")>();
  return { ...actual, apiRequest: ownerApi.apiRequest };
});

vi.mock("sonner", () => ({
  toast: notifications,
}));

import { RoomManagement } from "@/components/owner/RoomManagement";

const complete = {
  isComplete: true,
  missingItems: [],
  sections: [],
};

const namedRoomType: RoomTypeResponse = {
  id: 4,
  propertyId: 3,
  name: "زنبق",
  englishName: null,
  slug: "zanbagh",
  description: "نوع اتاق زنبق",
  maxAdults: 2,
  maxChildren: 0,
  allowExtraGuest: false,
  maxExtraGuests: 0,
  totalInventory: 1,
  activeRoomCount: 1,
  inventoryMode: "NamedRooms",
  basePrice: null,
  notes: null,
  floorNumber: null,
  stairCount: null,
  hasWindow: null,
  hasPrivateBathroom: null,
  isActive: true,
  completion: complete,
  bedConfigurations: [],
  amenities: [],
};

const typeBasedRoomType: RoomTypeResponse = {
  ...namedRoomType,
  id: 6,
  name: "دو تخته",
  slug: "double",
  totalInventory: 3,
  activeRoomCount: 0,
  inventoryMode: "TypeBasedInventory",
};

const emptyNamedRoomType: RoomTypeResponse = {
  ...namedRoomType,
  activeRoomCount: 0,
};

const physicalRoom: RoomResponse = {
  id: 20,
  roomTypeId: 4,
  name: "زنبق ۱",
  englishName: null,
  description: null,
  notes: null,
  floorNumber: null,
  stairCount: null,
  hasWindow: null,
  hasPrivateBathroom: null,
  isActive: true,
};

function arrangeApi(
  roomTypes: RoomTypeResponse[],
  options: { duplicate?: boolean; initialRooms?: RoomResponse[] } = {},
) {
  let created = false;
  ownerApi.apiRequest.mockImplementation(
    async (path: string, init?: RequestInit) => {
      if (path === "/bed-types" || path === "/amenities") return [];
      if (path === "/owner/properties/3/images") return [];
      if (path === "/owner/properties/3/room-types") {
        return created
          ? roomTypes.map((roomType) =>
              roomType.id === 4
                ? { ...roomType, activeRoomCount: 1 }
                : roomType,
            )
          : roomTypes;
      }
      if (path === "/owner/room-types/4/rooms" && init?.method === "POST") {
        if (options.duplicate) {
          throw new Error("A room with this name already exists for the room type.");
        }
        created = true;
        return physicalRoom;
      }
      if (path === "/owner/room-types/4/rooms") {
        return created ? [physicalRoom] : (options.initialRooms ?? []);
      }
      throw new Error(`Unexpected API request: ${path}`);
    },
  );
}

describe("named room management", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses RoomType terminology and lists physical rooms only for NamedRooms", async () => {
    arrangeApi([namedRoomType, typeBasedRoomType], {
      initialRooms: [physicalRoom],
    });

    render(<RoomManagement propertyId={3} />);

    expect(await screen.findByRole("button", { name: "افزودن نوع اتاق" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "افزودن اتاق" })).toBeNull();
    expect(await screen.findByText("اتاق‌های نام‌دار «زنبق»")).toBeTruthy();
    expect(await screen.findByText("زنبق ۱")).toBeTruthy();
    expect(screen.getAllByText("فعال").length).toBeGreaterThan(0);
    expect(screen.queryByText("اتاق‌های نام‌دار «دو تخته»")).toBeNull();
    expect(ownerApi.apiRequest).not.toHaveBeenCalledWith(
      "/owner/room-types/6/rooms",
    );
  });

  it("does not render named-room management for TypeBasedInventory", async () => {
    arrangeApi([typeBasedRoomType]);

    render(<RoomManagement propertyId={3} />);

    expect((await screen.findAllByText("دو تخته")).length).toBeGreaterThan(0);
    expect(screen.queryByRole("heading", { name: "اتاق‌های نام‌دار" })).toBeNull();
    expect(screen.queryByRole("button", { name: "افزودن اتاق نام‌دار" })).toBeNull();
  });

  it("creates a physical room and refreshes both room and RoomType lists", async () => {
    arrangeApi([emptyNamedRoomType]);
    render(<RoomManagement propertyId={3} />);

    expect(
      await screen.findByText(
        "برای قابل رزرو شدن، حداقل یک اتاق نام‌دار فعال برای این نوع اتاق ایجاد کنید.",
      ),
    ).toBeTruthy();
    fireEvent.click(
      await screen.findByRole("button", { name: "افزودن اتاق نام‌دار" }),
    );
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByRole("textbox", { name: /نام اتاق/ }), {
      target: { value: "  زنبق ۱  " },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "افزودن اتاق نام‌دار" }));

    await waitFor(() => {
      expect(ownerApi.apiRequest).toHaveBeenCalledWith(
        "/owner/room-types/4/rooms",
        {
          method: "POST",
          body: JSON.stringify({ name: "زنبق ۱" }),
        },
      );
    });
    await waitFor(() => expect(screen.getByText("زنبق ۱")).toBeTruthy());
    await waitFor(() =>
      expect(
        screen.queryByText(
          "برای قابل رزرو شدن، حداقل یک اتاق نام‌دار فعال برای این نوع اتاق ایجاد کنید.",
        ),
      ).toBeNull(),
    );

    const roomListCalls = ownerApi.apiRequest.mock.calls.filter(
      ([path, init]) => path === "/owner/room-types/4/rooms" && !init,
    );
    const roomTypeListCalls = ownerApi.apiRequest.mock.calls.filter(
      ([path]) => path === "/owner/properties/3/room-types",
    );
    expect(roomListCalls).toHaveLength(2);
    expect(roomTypeListCalls).toHaveLength(2);
    expect(notifications.success).toHaveBeenCalledWith(
      "اتاق نام‌دار با موفقیت افزوده شد.",
    );
  });

  it("rejects an empty name and translates duplicate-name failures", async () => {
    arrangeApi([namedRoomType], { duplicate: true });
    render(<RoomManagement propertyId={3} />);

    fireEvent.click(
      await screen.findByRole("button", { name: "افزودن اتاق نام‌دار" }),
    );
    const dialog = await screen.findByRole("dialog");
    const submit = within(dialog).getByRole("button", {
      name: "افزودن اتاق نام‌دار",
    });
    fireEvent.click(submit);
    expect(await within(dialog).findByText("نام اتاق الزامی است.")).toBeTruthy();
    expect(
      ownerApi.apiRequest.mock.calls.some(([, init]) => init?.method === "POST"),
    ).toBe(false);

    fireEvent.change(within(dialog).getByRole("textbox", { name: /نام اتاق/ }), {
      target: { value: "زنبق ۱" },
    });
    fireEvent.click(submit);
    expect(
      await within(dialog).findByText(
        "اتاقی با این نام قبلاً برای این نوع اتاق ثبت شده است.",
      ),
    ).toBeTruthy();
    expect(notifications.error).toHaveBeenCalledWith(
      "اتاقی با این نام قبلاً برای این نوع اتاق ثبت شده است.",
    );
  });
});
