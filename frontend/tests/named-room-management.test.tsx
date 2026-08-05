import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OwnerRoomResponse } from "@/lib/owner-api";

const ownerApi = vi.hoisted(() => ({ apiRequest: vi.fn() }));
const notifications = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));

vi.mock("@/lib/owner-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/owner-api")>();
  return { ...actual, apiRequest: ownerApi.apiRequest };
});

vi.mock("sonner", () => ({ toast: notifications }));
vi.mock("@/components/owner/PropertyImageManager", () => ({
  PropertyImageManager: () => <div>مدیریت تصاویر اتاق</div>,
}));

import { RoomManagement } from "@/components/owner/RoomManagement";

const roomKinds = [
  { value: 2, code: "double", titleFa: "دابل", titleEn: "Double", displayOrder: 20 },
  { value: 3, code: "twin", titleFa: "تویین", titleEn: "Twin", displayOrder: 30 },
];

const zanbagh: OwnerRoomResponse = {
  id: 20,
  roomTypeId: 4,
  name: "زنبق",
  englishName: null,
  description: null,
  notes: null,
  floorNumber: null,
  stairCount: null,
  hasWindow: true,
  hasPrivateBathroom: true,
  isActive: true,
  roomKind: "Double",
  roomKindCode: "double",
  inventoryMode: "NamedRooms",
  maxAdults: 2,
  maxChildren: 0,
  allowExtraGuest: false,
  maxExtraGuests: 0,
  basePrice: 2_500_000,
  bedConfigurations: [],
  amenities: [],
};

function arrangeApi(options: { initialRooms?: OwnerRoomResponse[]; duplicate?: boolean } = {}) {
  let rooms = [...(options.initialRooms ?? [])];
  ownerApi.apiRequest.mockImplementation(async (path: string, init?: RequestInit) => {
    if (path === "/bed-types" || path === "/amenities") return [];
    if (path === "/catalogs/room-kinds") return roomKinds;
    if (path === "/owner/properties/3/images") return [];
    if (path === "/owner/properties/3/rooms" && init?.method === "POST") {
      if (options.duplicate) {
        throw new Error("A room with this name already exists for the property.");
      }
      const payload = JSON.parse(String(init.body)) as Record<string, unknown>;
      const created: OwnerRoomResponse = {
        ...zanbagh,
        id: 20 + rooms.length,
        roomTypeId: 4,
        name: String(payload.name),
        roomKindCode: payload.roomKind === 3 ? "twin" : "double",
        roomKind: payload.roomKind === 3 ? "Twin" : "Double",
        basePrice: Number(payload.basePrice),
      };
      rooms = [...rooms, created];
      return created;
    }
    if (path === "/owner/properties/3/rooms") return rooms;
    throw new Error(`Unexpected API request: ${path}`);
  });
}

async function reachCreateStep(name = "زنبق") {
  fireEvent.click(await screen.findByRole("button", { name: "افزودن اتاق" }));
  const dialog = await screen.findByRole("dialog");
  fireEvent.change(within(dialog).getByLabelText(/نام اتاق/), {
    target: { value: name },
  });
  fireEvent.change(within(dialog).getByLabelText(/^نوع اتاق/), {
    target: { value: "double" },
  });
  fireEvent.change(within(dialog).getByLabelText(/قیمت پایه/), {
    target: { value: "2500000" },
  });
  fireEvent.click(within(dialog).getByRole("button", { name: "بعدی" }));
  fireEvent.click(within(dialog).getByRole("button", { name: "بعدی" }));
  fireEvent.click(within(dialog).getByRole("button", { name: "بعدی" }));
  return dialog;
}

describe("room-first owner management", () => {
  beforeEach(() => vi.clearAllMocks());

  it("shows physical rooms and hides internal RoomType terminology and names", async () => {
    arrangeApi({ initialRooms: [zanbagh] });
    render(<RoomManagement propertyId={3} />);

    expect(await screen.findByRole("button", { name: "افزودن اتاق" })).toBeTruthy();
    expect(screen.queryByText("افزودن نوع اتاق")).toBeNull();
    expect(await screen.findByText("زنبق")).toBeTruthy();
    expect(screen.getByText("دابل")).toBeTruthy();
    expect(screen.getByText("۲٬۵۰۰٬۰۰۰ تومان")).toBeTruthy();
    expect(screen.queryByText("Double-1")).toBeNull();
  });

  it("loads RoomKind choices and creates one physical room with its template specification", async () => {
    arrangeApi();
    render(<RoomManagement propertyId={3} />);
    const dialog = await reachCreateStep();

    fireEvent.click(
      within(dialog).getByRole("button", { name: "ثبت و ادامه به تصاویر" }),
    );

    await waitFor(() => {
      expect(ownerApi.apiRequest).toHaveBeenCalledWith(
        "/owner/properties/3/rooms",
        expect.objectContaining({ method: "POST" }),
      );
    });
    const call = ownerApi.apiRequest.mock.calls.find(
      ([path, init]) => path === "/owner/properties/3/rooms" && init?.method === "POST",
    );
    const payload = JSON.parse(String(call?.[1]?.body));
    expect(payload).toMatchObject({
      name: "زنبق",
      roomKind: 2,
      maxAdults: 2,
      inventoryMode: "NamedRooms",
      basePrice: 2_500_000,
    });
    expect(payload).not.toHaveProperty("propertyId");
    expect(await within(dialog).findByText("مدیریت تصاویر اتاق")).toBeTruthy();
    expect(await screen.findByText("زنبق")).toBeTruthy();
  });

  it("adds a second room and immediately refreshes the physical-room count", async () => {
    arrangeApi({ initialRooms: [zanbagh] });
    render(<RoomManagement propertyId={3} />);
    const dialog = await reachCreateStep("محراب");
    fireEvent.click(
      within(dialog).getByRole("button", { name: "ثبت و ادامه به تصاویر" }),
    );

    expect(await screen.findByText("محراب")).toBeTruthy();
    expect(screen.getByText("زنبق")).toBeTruthy();
    const roomListCalls = ownerApi.apiRequest.mock.calls.filter(
      ([path, init]) => path === "/owner/properties/3/rooms" && !init,
    );
    expect(roomListCalls).toHaveLength(2);
  });

  it("rejects blank room names before POST and translates duplicate failures", async () => {
    arrangeApi({ duplicate: true });
    render(<RoomManagement propertyId={3} />);
    fireEvent.click(await screen.findByRole("button", { name: "افزودن اتاق" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "بعدی" }));
    expect(notifications.error).toHaveBeenCalledWith("نام اتاق الزامی است.");
    expect(ownerApi.apiRequest.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);

    fireEvent.change(within(dialog).getByLabelText(/نام اتاق/), {
      target: { value: "زنبق" },
    });
    fireEvent.change(within(dialog).getByLabelText(/^نوع اتاق/), {
      target: { value: "double" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "بعدی" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "بعدی" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "بعدی" }));
    fireEvent.click(
      within(dialog).getByRole("button", { name: "ثبت و ادامه به تصاویر" }),
    );
    expect(
      await within(dialog).findByText(
        "اتاقی با این نام قبلاً در این اقامتگاه ثبت شده است.",
      ),
    ).toBeTruthy();
  });
});
