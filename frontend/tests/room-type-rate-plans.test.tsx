import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RoomTypeRatePlanResponse, RoomTypeResponse } from "@/lib/owner-api";

const requests = vi.hoisted(() => ({
  apiRequest: vi.fn(),
  listRoomTypeRatePlans: vi.fn(),
  listPropertyMealPlans: vi.fn(),
  createRoomTypeRatePlan: vi.fn(),
  updateRoomTypeRatePlan: vi.fn(),
  deleteRoomTypeRatePlan: vi.fn(),
}));
const notifications = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn() }));

vi.mock("@/lib/owner-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/owner-api")>()), ...requests,
}));
vi.mock("@/lib/currency", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/currency")>()),
  useSiteCurrencyLabel: () => "واحد آزمون",
}));
vi.mock("sonner", () => ({ toast: notifications }));
vi.mock("@/components/owner/PropertyImageManager", () => ({
  PropertyImageManager: () => null,
}));

import { RoomManagement } from "@/components/owner/RoomManagement";

const roomType: RoomTypeResponse = {
  id: 4, propertyId: 3, name: "زنبق", englishName: null, slug: "zanbagh",
  description: "اتاق زنبق", maxAdults: 2, maxChildren: 0, allowExtraGuest: false,
  maxExtraGuests: 0, totalInventory: 1, activeRoomCount: 1,
  inventoryMode: "TypeBasedInventory", roomKind: "Double", roomKindCode: "double",
  basePrice: 3_000_000, notes: null, floorNumber: null, stairCount: null,
  hasWindow: true, hasPrivateBathroom: true, isActive: true,
  completion: { isComplete: true, missingItems: [], sections: [] },
  bedConfigurations: [], amenities: [],
};

const plan = (id: number, value: number): RoomTypeRatePlanResponse => ({
  id, roomTypeId: 4, name: `نرخ ${id}`, mealPlanId: 7, mealPlanName: "صبحانه",
  mealPlanSlug: "breakfast", cancellationPolicyId: null,
  priceModifierType: "FixedAmount", priceModifierValue: value,
  minimumNights: 2, isActive: true,
});

let plans: RoomTypeRatePlanResponse[];

beforeEach(() => {
  vi.clearAllMocks();
  plans = [];
  requests.apiRequest.mockImplementation(async (path: string) => {
    if (path === "/owner/properties/3/room-types") return [roomType];
    if (path === "/owner/properties/3/images") return [];
    if (path === "/bed-types" || path === "/amenity-categories" || path === "/amenities") return [];
    if (path === "/catalogs/room-kinds") return [{ code: "double", titleFa: "دابل" }];
    throw new Error(`Unexpected API: ${path}`);
  });
  requests.listRoomTypeRatePlans.mockImplementation(async () => plans);
  requests.listPropertyMealPlans.mockResolvedValue([{ id: 7, name: "صبحانه", slug: "breakfast" }]);
  requests.createRoomTypeRatePlan.mockImplementation(async (_propertyId, _roomTypeId, payload) => {
    const created = { ...plan(51, payload.priceModifierValue), ...payload, id: 51 };
    plans = [...plans, created];
    return created;
  });
  requests.updateRoomTypeRatePlan.mockImplementation(async (_propertyId, _roomTypeId, id, payload) => {
    const updated = { ...plans.find((item) => item.id === id), ...payload, id };
    plans = plans.map((item) => item.id === id ? updated : item);
    return updated;
  });
  requests.deleteRoomTypeRatePlan.mockImplementation(async (_propertyId, _roomTypeId, id) => {
    plans = plans.filter((item) => item.id !== id);
  });
});

async function openRates(compactHeader = false) {
  render(<RoomManagement propertyId={3} compactHeader={compactHeader} />);
  fireEvent.click(await screen.findByRole("button", { name: "نرخ‌های فروش" }));
  const dialog = await screen.findByRole("dialog", { name: "نرخ‌های فروش زنبق" });
  await waitFor(() => expect(requests.listRoomTypeRatePlans).toHaveBeenCalledWith(3, 4));
  return dialog;
}

async function openCreate() {
  const dialog = await openRates();
  fireEvent.click(await within(dialog).findByRole("button", { name: "افزودن نرخ فروش" }));
  return dialog;
}

describe("RoomType RatePlan management", () => {
  it("opens from the shared Admin/Owner RoomType surface and shows the base plus empty state", async () => {
    const dialog = await openRates(true);
    expect(within(dialog).getByText("نرخ استاندارد")).toBeTruthy();
    expect(within(dialog).getByText(/قیمت پایه تقویم/)).toBeTruthy();
    expect(within(dialog).getByText("نرخ دیگری برای این نوع اتاق تعریف نشده است.")).toBeTruthy();
    expect(requests.listPropertyMealPlans).toHaveBeenCalledWith(3);
    expect(requests.createRoomTypeRatePlan).not.toHaveBeenCalled();
  });

  it("renders signed relationships, meal names, minimum nights and active state", async () => {
    plans = [plan(51, -300_000), { ...plan(52, 0), isActive: false }, plan(53, 500_000)];
    const dialog = await openRates();
    expect(within(dialog).getByText("۳۰۰٬۰۰۰ واحد آزمون کمتر از نرخ پایه")).toBeTruthy();
    expect(within(dialog).getByText("همان قیمت پایه")).toBeTruthy();
    expect(within(dialog).getByText("۵۰۰٬۰۰۰ واحد آزمون بیشتر از نرخ پایه")).toBeTruthy();
    expect(within(dialog).getAllByText("برنامه غذایی: صبحانه")).toHaveLength(3);
    expect(within(dialog).getAllByText("حداقل اقامت: ۲ شب")).toHaveLength(3);
    expect(within(dialog).getByText("غیرفعال")).toBeTruthy();
  });

  it.each([
    ["decrease", "300000", -300000],
    ["increase", "500000", 500000],
    ["same", "", 0],
  ] as const)("maps %s to signed fixed amount %s", async (direction, amount, expected) => {
    const dialog = await openCreate();
    fireEvent.change(within(dialog).getByRole("textbox", { name: /نام نرخ فروش/ }), { target: { value: "بدون صبحانه" } });
    fireEvent.change(within(dialog).getByRole("combobox", { name: "برنامه غذایی" }), { target: { value: "7" } });
    fireEvent.change(within(dialog).getByRole("combobox", { name: /رابطه با قیمت پایه/ }), { target: { value: direction } });
    if (amount) fireEvent.change(within(dialog).getByRole("spinbutton", { name: /مبلغ تعدیل/ }), { target: { value: amount } });
    fireEvent.click(within(dialog).getByRole("button", { name: "ذخیره نرخ فروش" }));
    await waitFor(() => expect(requests.createRoomTypeRatePlan).toHaveBeenCalledWith(3, 4, expect.objectContaining({
      name: "بدون صبحانه", mealPlanId: 7, cancellationPolicyId: null,
      priceModifierType: "FixedAmount", priceModifierValue: expected,
    })));
    expect(within(dialog).queryByText("درصدی")).toBeNull();
  });

  it("loads an existing negative modifier for editing and preserves its hidden policy", async () => {
    plans = [{ ...plan(51, -300000), cancellationPolicyId: 99 }];
    const dialog = await openRates();
    fireEvent.click(within(dialog).getByRole("button", { name: "ویرایش" }));
    expect((within(dialog).getByRole("combobox", { name: /رابطه با قیمت پایه/ }) as HTMLSelectElement).value).toBe("decrease");
    expect((within(dialog).getByRole("spinbutton", { name: /مبلغ تعدیل/ }) as HTMLInputElement).value).toBe("300000");
    expect((within(dialog).getByRole("spinbutton", { name: "حداقل شب‌های اقامت" }) as HTMLInputElement).value).toBe("2");
    fireEvent.click(within(dialog).getByRole("button", { name: "ذخیره نرخ فروش" }));
    await waitFor(() => expect(requests.updateRoomTypeRatePlan).toHaveBeenCalledWith(3, 4, 51,
      expect.objectContaining({ cancellationPolicyId: 99, priceModifierValue: -300000 })));
  });

  it("rejects invalid minimum nights without sending a request", async () => {
    const dialog = await openCreate();
    fireEvent.change(within(dialog).getByRole("textbox", { name: /نام نرخ فروش/ }), { target: { value: "بدون صبحانه" } });
    fireEvent.change(within(dialog).getByRole("spinbutton", { name: "حداقل شب‌های اقامت" }), { target: { value: "0" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "ذخیره نرخ فروش" }));
    expect(await within(dialog).findByText("حداقل شب‌ها باید عدد صحیح مثبت باشد.")).toBeTruthy();
    expect(requests.createRoomTypeRatePlan).not.toHaveBeenCalled();
  });

  it("submits optional minimum nights and inactive state without a percentage option", async () => {
    const dialog = await openCreate();
    fireEvent.change(within(dialog).getByRole("textbox", { name: /نام نرخ فروش/ }), { target: { value: "فول بورد" } });
    fireEvent.change(within(dialog).getByRole("spinbutton", { name: "حداقل شب‌های اقامت" }), { target: { value: "3" } });
    fireEvent.click(within(dialog).getByRole("checkbox", { name: "نرخ فروش فعال باشد" }));
    expect(within(dialog).queryByRole("option", { name: "درصدی" })).toBeNull();
    fireEvent.click(within(dialog).getByRole("button", { name: "ذخیره نرخ فروش" }));
    await waitFor(() => expect(requests.createRoomTypeRatePlan).toHaveBeenCalledWith(3, 4,
      expect.objectContaining({ minimumNights: 3, isActive: false, priceModifierValue: 0 })));
  });

  it("keeps the form open and its values when the backend rejects a save", async () => {
    requests.createRoomTypeRatePlan.mockRejectedValueOnce(new Error("مبلغ با قیمت پایه سازگار نیست"));
    const dialog = await openCreate();
    fireEvent.change(within(dialog).getByRole("textbox", { name: /نام نرخ فروش/ }), { target: { value: "بدون صبحانه" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "ذخیره نرخ فروش" }));
    expect(await within(dialog).findByText("مبلغ با قیمت پایه سازگار نیست")).toBeTruthy();
    expect((within(dialog).getByRole("textbox", { name: /نام نرخ فروش/ }) as HTMLInputElement).value).toBe("بدون صبحانه");
    expect(notifications.error).toHaveBeenCalled();
  });

  it("confirms deletion before DELETE and reloads the list", async () => {
    plans = [plan(51, -300000)];
    const dialog = await openRates();
    fireEvent.click(within(dialog).getByRole("button", { name: "حذف" }));
    expect(requests.deleteRoomTypeRatePlan).not.toHaveBeenCalled();
    await screen.findByRole("alertdialog", { name: "حذف نرخ فروش" });
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("alertdialog", { name: "حذف نرخ فروش" })).toBeNull());
    expect(screen.getByRole("dialog", { name: "نرخ‌های فروش زنبق" })).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "حذف" }));
    const reopenedConfirmation = await screen.findByRole("alertdialog", { name: "حذف نرخ فروش" });
    fireEvent.click(within(reopenedConfirmation).getByRole("button", { name: "انصراف" }));
    expect(requests.deleteRoomTypeRatePlan).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "حذف" }));
    fireEvent.click(within(await screen.findByRole("alertdialog", { name: "حذف نرخ فروش" })).getByRole("button", { name: "حذف" }));
    await waitFor(() => expect(requests.deleteRoomTypeRatePlan).toHaveBeenCalledWith(3, 4, 51));
    await waitFor(() => expect(within(dialog).getByText("نرخ دیگری برای این نوع اتاق تعریف نشده است.")).toBeTruthy());
    expect(requests.listRoomTypeRatePlans).toHaveBeenCalledTimes(2);
  });

  it("surfaces API errors without closing the management dialog", async () => {
    requests.listRoomTypeRatePlans.mockRejectedValueOnce(new Error("دریافت فهرست ناموفق بود"));
    const dialog = await openRates();
    expect(await within(dialog).findByText(/دریافت فهرست ناموفق بود/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "تلاش دوباره" }));
    expect(await within(dialog).findByText("نرخ دیگری برای این نوع اتاق تعریف نشده است.")).toBeTruthy();
  });
});
