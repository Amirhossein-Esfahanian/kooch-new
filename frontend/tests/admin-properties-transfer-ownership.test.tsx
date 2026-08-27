import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AdminPropertyOwnerCandidatePageResponse,
  PropertyResponse,
} from "@/lib/owner-api";

const ownerApi = vi.hoisted(() => ({
  apiRequest: vi.fn(),
}));

const notifications = vi.hoisted(() => ({
  error: vi.fn(),
  success: vi.fn(),
}));

const session = vi.hoisted(() => ({
  authenticated: true,
  loading: false,
  platformPermissions: ["ManageProperties"],
  platformRole: "SuperAdmin",
  propertyMemberships: [],
  user: { userId: 1, fullName: "Admin User" },
  workspaces: ["admin"],
}));

vi.mock("@/lib/owner-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/owner-api")>();
  return { ...actual, apiRequest: ownerApi.apiRequest };
});

vi.mock("@/components/auth/AuthSessionProvider", () => ({
  useAuthSession: () => session,
}));

vi.mock("@/components/dashboard/DashboardLayouts", () => ({
  AdminLayout: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/admin/properties",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

vi.mock("sonner", () => ({
  toast: notifications,
}));

import AdminPropertiesPage from "@/app/admin/properties/page";

const property: PropertyResponse = {
  id: 100,
  ownerId: 2,
  ownerName: "مالک فعلی",
  ownerEmail: "current@example.test",
  createdAtUtc: "2026-07-29T00:00:00Z",
  destinationId: 10,
  destinationName: "کاشان",
  name: "خانه کاشان",
  englishName: null,
  slug: "kashan-house",
  description: "Test",
  seoTitle: null,
  seoDescription: null,
  address: "Address",
  city: "Kashan",
  country: "Iran",
  latitude: null,
  longitude: null,
  status: "Draft",
  type: "TraditionalHouse",
  inventoryMode: "NamedRooms",
  checkInTime: null,
  checkOutTime: null,
  breakfastOption: "NoBreakfast",
  breakfastPrice: null,
  totalAreaM2: null,
  landAreaM2: null,
  floorsCount: null,
  stairCount: null,
  hasElevator: false,
  isWheelchairAccessible: null,
  hasGroundFloorRoom: null,
  hasAccessibleBathroom: null,
  freeChildAgeLimit: null,
  maxFreeChildren: null,
  childPrice: null,
  extraGuestPrice: null,
};

const candidatePage: AdminPropertyOwnerCandidatePageResponse = {
  items: [
    {
      id: 7,
      firstName: "مدیر",
      lastName: "سامانه",
      fullName: "مدیر سامانه",
      phoneNumber: "09121234567",
      email: "assistant@example.test",
    },
  ],
  totalCount: 1,
  page: 1,
  pageSize: 10,
  totalPages: 1,
};

function updatedProperty(ownerName = "مدیر سامانه"): PropertyResponse {
  return {
    ...property,
    ownerId: 7,
    ownerName,
    ownerEmail: "assistant@example.test",
  };
}

async function openTransferDialog() {
  render(<AdminPropertiesPage />);
  fireEvent.click(await screen.findByRole("button", { name: "انتقال مالکیت" }));
  return screen.findByRole("alertdialog", { name: "انتقال مالکیت اقامتگاه" });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("Admin property transfer ownership", () => {
  it("creates a property without exposing or sending the legacy inventory model", async () => {
    ownerApi.apiRequest.mockImplementation((path: string, options?: RequestInit) => {
      if (path === "/admin/properties" && !options) return Promise.resolve([]);
      if (path.startsWith("/admin/properties/owner-candidates?")) {
        return Promise.resolve(candidatePage);
      }
      if (path === "/admin/properties" && options?.method === "POST") {
        return Promise.resolve({
          ...property,
          inventoryMode: "TypeBasedInventory",
        });
      }
      throw new Error(`Unexpected API request: ${path}`);
    });

    render(<AdminPropertiesPage />);
    fireEvent.click(
      await screen.findByRole("button", { name: "افزودن اقامتگاه" }),
    );

    const dialog = await screen.findByRole("dialog", {
      name: "افزودن اقامتگاه",
    });
    expect(within(dialog).queryByLabelText("مدل موجودی")).toBeNull();
    expect(
      within(dialog).queryByRole("option", { name: "اتاق‌های نام‌دار" }),
    ).toBeNull();

    const userSearch = within(dialog).getByLabelText("جست‌وجوی کاربر");
    const ownerSelect = within(dialog).getByLabelText(/مالک اقامتگاه/);
    const ownerFields = userSearch.parentElement?.parentElement;
    expect(ownerFields).toBe(ownerSelect.parentElement?.parentElement);
    expect(ownerFields?.className).toContain("md:grid-cols-2");
    expect((within(dialog).getByLabelText(/شهر/) as HTMLInputElement).value).toBe(
      "کاشان",
    );
    await waitFor(() => expect(ownerSelect.hasAttribute("disabled")).toBe(false));
    fireEvent.change(ownerSelect, { target: { value: "7" } });
    fireEvent.change(within(dialog).getByLabelText(/نام اقامتگاه/), {
      target: { value: "اقامتگاه جدید" },
    });
    fireEvent.change(within(dialog).getByLabelText(/آدرس/), {
      target: { value: "کاشان، خیابان نمونه" },
    });
    fireEvent.click(
      within(dialog).getByRole("button", { name: "ایجاد پیش‌نویس" }),
    );

    await waitFor(() => {
      const createCall = ownerApi.apiRequest.mock.calls.find(
        ([path, options]) =>
          path === "/admin/properties" && options?.method === "POST",
      );
      expect(createCall).toBeTruthy();
      const payload = JSON.parse(String(createCall?.[1]?.body));
      expect(payload).not.toHaveProperty("inventoryMode");
      expect(payload).toMatchObject({
        name: "اقامتگاه جدید",
        address: "کاشان، خیابان نمونه",
        city: "کاشان",
        ownerId: 7,
        status: "Draft",
      });
    });
  });

  it("uses bounded search, confirms the demotion outcome, prevents duplicates, and refreshes", async () => {
    let resolveTransfer!: (value: PropertyResponse) => void;
    const transferResponse = new Promise<PropertyResponse>((resolve) => {
      resolveTransfer = resolve;
    });
    let propertyReads = 0;
    ownerApi.apiRequest.mockImplementation((path: string, options?: RequestInit) => {
      if (path === "/admin/properties" && !options) {
        propertyReads += 1;
        return Promise.resolve(propertyReads === 1 ? [property] : [updatedProperty()]);
      }
      if (path.startsWith("/admin/properties/owner-candidates?")) {
        return Promise.resolve(candidatePage);
      }
      if (path === "/admin/properties/100/transfer-ownership") {
        return transferResponse;
      }
      return Promise.reject(new Error(`Unexpected API request: ${path}`));
    });

    const dialog = await openTransferDialog();
    expect(within(dialog).getByText("انتخاب کاربر موجود")).toBeTruthy();
    expect(within(dialog).getByText("ساخت کاربر جدید")).toBeTruthy();
    expect(ownerApi.apiRequest).not.toHaveBeenCalledWith(
      "/admin/properties/100/transfer-ownership",
      expect.anything(),
    );

    await waitFor(() =>
      expect(ownerApi.apiRequest).toHaveBeenCalledWith(
        expect.stringMatching(
          /^\/admin\/properties\/owner-candidates\?search=&page=1&pageSize=10&excludeUserId=2$/,
        ),
      ),
    );
    expect(within(dialog).getByText(/مدیر سامانه/)).toBeTruthy();
    fireEvent.change(within(dialog).getByLabelText(/مالک جدید/), {
      target: { value: "7" },
    });
    fireEvent.change(within(dialog).getByLabelText("نحوه دسترسی مالک قبلی"), {
      target: { value: "Demote" },
    });
    fireEvent.change(within(dialog).getByLabelText("نقش جدید مالک قبلی"), {
      target: { value: "Reception" },
    });

    expect(within(dialog).getByText(/مالک فعلی/)).toBeTruthy();
    expect(within(dialog).getByText(/نقش «پذیرش»/)).toBeTruthy();

    const confirm = within(dialog).getByRole("button", {
      name: "تأیید انتقال مالکیت",
    });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    await waitFor(() => {
      const transfers = ownerApi.apiRequest.mock.calls.filter(
        ([path]) => path === "/admin/properties/100/transfer-ownership",
      );
      expect(transfers).toHaveLength(1);
      const payload = JSON.parse((transfers[0][1] as RequestInit).body as string);
      expect(payload).toMatchObject({
        newOwnerId: 7,
        newOwner: null,
        previousOwnerAction: "Demote",
        previousOwnerRole: "Reception",
      });
    });

    resolveTransfer(updatedProperty());
    await waitFor(() => expect(propertyReads).toBe(2));
    expect(await screen.findByText("مدیر سامانه")).toBeTruthy();
    expect(notifications.success).toHaveBeenCalledWith(
      "انتقال مالکیت با موفقیت انجام شد.",
    );
  });

  it("reuses CreateUserFields and submits a new user with optional email", async () => {
    ownerApi.apiRequest.mockImplementation((path: string, options?: RequestInit) => {
      if (path === "/admin/properties" && !options) return Promise.resolve([property]);
      if (path === "/admin/properties/100/transfer-ownership") {
        return Promise.resolve(updatedProperty("کاربر جدید"));
      }
      if (path.startsWith("/admin/properties/owner-candidates?")) {
        return Promise.resolve(candidatePage);
      }
      return Promise.reject(new Error(`Unexpected API request: ${path}`));
    });

    const dialog = await openTransferDialog();
    fireEvent.click(within(dialog).getByRole("button", { name: "ساخت کاربر جدید" }));
    expect(within(dialog).getByTestId("create-user-fields")).toBeTruthy();

    fireEvent.change(document.getElementById("transfer-owner-first-name")!, {
      target: { value: "کاربر" },
    });
    fireEvent.change(document.getElementById("transfer-owner-last-name")!, {
      target: { value: "جدید" },
    });
    fireEvent.change(document.getElementById("transfer-owner-mobile")!, {
      target: { value: "09123334444" },
    });
    fireEvent.change(within(dialog).getByLabelText(/رمز عبور اولیه/), {
      target: { value: "password1" },
    });

    fireEvent.click(
      within(dialog).getByRole("button", { name: "تأیید انتقال مالکیت" }),
    );
    await waitFor(() => {
      const call = ownerApi.apiRequest.mock.calls.find(
        ([path]) => path === "/admin/properties/100/transfer-ownership",
      );
      expect(call).toBeTruthy();
      const payload = JSON.parse((call![1] as RequestInit).body as string);
      expect(payload.newOwnerId).toBeNull();
      expect(payload.newOwner).toEqual({
        firstName: "کاربر",
        lastName: "جدید",
        email: null,
        phoneNumber: "09123334444",
        password: "password1",
      });
      expect(payload.previousOwnerAction).toBe("DeactivateMembership");
      expect(payload.previousOwnerRole).toBeNull();
    });
  });

  it("shows a safe Persian message instead of a raw backend exception", async () => {
    ownerApi.apiRequest.mockImplementation((path: string, options?: RequestInit) => {
      if (path === "/admin/properties" && !options) return Promise.resolve([property]);
      if (path.startsWith("/admin/properties/owner-candidates?")) {
        return Promise.resolve(candidatePage);
      }
      if (path === "/admin/properties/100/transfer-ownership") {
        return Promise.reject(new Error("SQL sensitive internal exception"));
      }
      return Promise.reject(new Error(`Unexpected API request: ${path}`));
    });

    const dialog = await openTransferDialog();
    await waitFor(() => expect(within(dialog).getByText(/مدیر سامانه/)).toBeTruthy());
    fireEvent.change(within(dialog).getByLabelText(/مالک جدید/), {
      target: { value: "7" },
    });
    fireEvent.click(
      within(dialog).getByRole("button", { name: "تأیید انتقال مالکیت" }),
    );

    await waitFor(() =>
      expect(notifications.error).toHaveBeenCalledWith(
        "انتقال مالکیت انجام نشد.",
      ),
    );
    expect(screen.queryByText(/SQL sensitive/)).toBeNull();
  });
});
