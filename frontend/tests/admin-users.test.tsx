import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const ownerApi = vi.hoisted(() => ({
  apiRequest: vi.fn(),
}));

const auth = vi.hoisted(() => ({
  current: {
    authenticated: true,
    loading: false,
    platformRole: "SuperAdmin" as "SuperAdmin" | "AdminAssistant",
    platformPermissions: [] as string[],
    workspaces: ["admin"] as string[],
  },
}));

const notifications = vi.hoisted(() => ({
  error: vi.fn(),
  success: vi.fn(),
}));

const navigation = vi.hoisted(() => ({
  push: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => navigation,
}));

vi.mock("@/lib/owner-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/owner-api")>();
  return { ...actual, apiRequest: ownerApi.apiRequest };
});

vi.mock("@/components/auth/AuthSessionProvider", () => ({
  useAuthSession: () => auth.current,
}));

vi.mock("@/components/dashboard/DashboardLayouts", () => ({
  AdminLayout: ({
    children,
    requiredPlatformPermission,
  }: {
    children: ReactNode;
    requiredPlatformPermission?: string;
  }) => (
    <div data-required-permission={requiredPlatformPermission}>{children}</div>
  ),
}));

vi.mock("sonner", () => ({
  toast: notifications,
}));

import AdminUsersPage from "@/app/admin/users/page";
import type { AdminUserResponse, PropertyResponse } from "@/lib/owner-api";

Object.defineProperty(HTMLElement.prototype, "scrollTo", {
  configurable: true,
  value: vi.fn(),
});

function adminUser(
  id: number,
  options: Partial<AdminUserResponse> = {},
): AdminUserResponse {
  return {
    id,
    firstName: "Test",
    lastName: "User " + id,
    fullName: "Test User " + id,
    email: "user-" + id + "@example.test",
    phoneNumber: "0912000000" + id,
    role: "AdminAssistant",
    parentUserId: null,
    parentUserName: null,
    permissions: [],
    isActive: true,
    passwordSetupRequired: false,
    createdAtUtc: "2026-07-29T00:00:00Z",
    invitationAcceptedAtUtc: null,
    temporarySetupLink: null,
    ...options,
  };
}

function property(
  id: number,
  options: Partial<PropertyResponse> = {},
): PropertyResponse {
  return {
    id,
    name: `اقامتگاه ${id}`,
    city: "کاشان",
    ownerName: "مالک نمونه",
    ownerEmail: "owner@example.test",
    ...options,
  } as PropertyResponse;
}

function setActor(
  role: "SuperAdmin" | "AdminAssistant",
  permissions: string[] = [],
) {
  auth.current = {
    authenticated: true,
    loading: false,
    platformRole: role,
    platformPermissions: permissions,
    workspaces: ["admin"],
  };
}

function input(selector: string) {
  return document.querySelector<HTMLInputElement>(selector)!;
}

beforeEach(() => {
  vi.clearAllMocks();
  setActor("SuperAdmin");
});

describe("Admin Users page", () => {
  it("shows loading, then renders a successful list", async () => {
    let resolveUsers!: (users: AdminUserResponse[]) => void;
    const usersRequest = new Promise<AdminUserResponse[]>((resolve) => {
        resolveUsers = resolve;
    });
    ownerApi.apiRequest.mockImplementation((path: string) =>
      path === "/admin/properties" ? Promise.resolve([]) : usersRequest,
    );

    render(<AdminUsersPage />);
    expect(screen.getByText("در حال بارگذاری...")).toBeTruthy();
    expect(
      screen.getByRole("heading", {
        name: "کاربران مدیریتی سامانه",
        level: 1,
      }),
    ).toBeTruthy();
    expect(
      screen.getByRole("heading", {
        name: "کاربران مدیریتی سامانه",
        level: 2,
      }),
    ).toBeTruthy();
    const platformTab = screen.getByRole("tab", {
      name: "کاربران مدیریتی سامانه",
    });
    const propertyTab = screen.getByRole("tab", {
      name: "اعضای اقامتگاه‌ها",
    });
    expect(platformTab.getAttribute("aria-selected")).toBe("true");
    expect(
      screen.queryByRole("heading", { name: "اعضای اقامتگاه‌ها", level: 2 }),
    ).toBeNull();

    fireEvent.click(
      screen.getByRole("button", { name: "مدیریت اعضای اقامتگاه‌ها" }),
    );
    expect(propertyTab.getAttribute("aria-selected")).toBe("true");
    expect(
      screen.getByRole("heading", { name: "اعضای اقامتگاه‌ها", level: 2 }),
    ).toBeTruthy();
    expect(
      screen.getByText(
        "مالک اقامتگاه از مسیر مدیریت یا انتقال مالکیت اقامتگاه تعیین می‌شود.",
      ),
    ).toBeTruthy();

    fireEvent.click(platformTab);

    resolveUsers([adminUser(1)]);
    expect(await screen.findByText("Test User 1")).toBeTruthy();
    expect(
      document.querySelector('[data-required-permission="ManageUsers"]'),
    ).toBeTruthy();
  });

  it("supports roving keyboard focus between the two management views", async () => {
    ownerApi.apiRequest.mockResolvedValue([]);

    render(<AdminUsersPage />);

    const platformTab = screen.getByRole("tab", {
      name: "کاربران مدیریتی سامانه",
    });
    const propertyTab = screen.getByRole("tab", {
      name: "اعضای اقامتگاه‌ها",
    });

    platformTab.focus();
    fireEvent.keyDown(platformTab, { key: "End" });
    expect(propertyTab.getAttribute("aria-selected")).toBe("true");
    expect(propertyTab.tabIndex).toBe(0);
    expect(document.activeElement).toBe(propertyTab);

    fireEvent.keyDown(propertyTab, { key: "Home" });
    expect(platformTab.getAttribute("aria-selected")).toBe("true");
    expect(platformTab.tabIndex).toBe(0);
    expect(document.activeElement).toBe(platformTab);
  });

  it("renders the empty state", async () => {
    ownerApi.apiRequest.mockResolvedValue([]);

    render(<AdminUsersPage />);

    expect(
      await screen.findByText("هنوز کاربری ثبت نشده است."),
    ).toBeTruthy();
  });

  it("renders API failures through KoochAlert", async () => {
    ownerApi.apiRequest.mockImplementation((path: string) =>
      path === "/admin/users"
        ? Promise.reject(new Error("فهرست در دسترس نیست"))
        : Promise.resolve([]),
    );

    render(<AdminUsersPage />);

    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByText("فهرست در دسترس نیست")).toBeTruthy();
    expect(notifications.error).toHaveBeenCalledWith("فهرست در دسترس نیست");
  });

  it("creates through shared fields, permissions, and refreshes the list", async () => {
    const created = adminUser(2, {
      firstName: "New",
      lastName: "Admin",
      fullName: "New Admin",
      permissions: ["ManageUsers"],
    });
    let users: AdminUserResponse[] = [];
    ownerApi.apiRequest.mockImplementation(
      (path: string, options?: RequestInit) => {
        if (path === "/admin/properties") return Promise.resolve([]);
        if (path === "/admin/users" && !options) {
          return Promise.resolve(users);
        }
        if (path === "/admin/users" && options?.method === "POST") {
          users = [created];
          return Promise.resolve(created);
        }
        return Promise.reject(new Error("Unexpected request: " + path));
      },
    );
    render(<AdminUsersPage />);
    await screen.findByText("هنوز کاربری ثبت نشده است.");

    fireEvent.click(screen.getByRole("button", { name: "افزودن مدیر سامانه" }));
    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByRole("heading", { name: "افزودن مدیر سامانه" }),
    ).toBeTruthy();
    expect(
      within(dialog).getByLabelText("مراحل فرم مدیر سامانه"),
    ).toBeTruthy();
    expect(within(dialog).getByTestId("create-user-fields")).toBeTruthy();
    const roleSelect = within(dialog).getByRole("combobox");
    expect(within(roleSelect).getByRole("option", { name: "مدیر ارشد" }))
      .toBeTruthy();
    expect(within(roleSelect).getByRole("option", { name: "دستیار مدیر" }))
      .toBeTruthy();
    for (const propertyRole of [
      "Owner",
      "OwnerAssistant",
      "Client",
      "PropertyOwner",
      "Manager",
      "Reception",
      "Accounting",
      "Housekeeping",
      "Custom",
    ]) {
      expect(
        within(roleSelect).queryByRole("option", { name: propertyRole }),
      ).toBeNull();
    }

    fireEvent.change(input("#admin-user-first-name"), {
      target: { value: "New" },
    });
    fireEvent.change(input("#admin-user-last-name"), {
      target: { value: "Admin" },
    });
    fireEvent.change(input("#admin-user-mobile"), {
      target: { value: "09123456789" },
    });
    expect(
      ownerApi.apiRequest.mock.calls.some(
        ([path, options]) => path === "/admin/users" && options?.method === "POST",
      ),
    ).toBe(false);
    fireEvent.click(within(dialog).getByRole("button", { name: "ادامه" }));
    fireEvent.click(within(dialog).getByLabelText("مدیریت کاربران"));
    fireEvent.click(within(dialog).getByRole("button", { name: "ادامه" }));
    expect(
      ownerApi.apiRequest.mock.calls.some(
        ([path, options]) => path === "/admin/users" && options?.method === "POST",
      ),
    ).toBe(false);
    fireEvent.click(within(dialog).getByRole("button", { name: "ذخیره" }));

    await waitFor(() => {
      expect(ownerApi.apiRequest).toHaveBeenCalledWith(
        "/admin/users",
        expect.objectContaining({ method: "POST" }),
      );
    });
    const createCall = ownerApi.apiRequest.mock.calls.find(
      ([path, options]) =>
        path === "/admin/users" && options?.method === "POST",
    )!;
    expect(JSON.parse(String(createCall[1].body))).toEqual(
      expect.objectContaining({
        firstName: "New",
        lastName: "Admin",
        phoneNumber: "09123456789",
        role: "AdminAssistant",
        permissions: ["ManageUsers"],
      }),
    );
    expect(await screen.findByText("New Admin")).toBeTruthy();
    expect(
      ownerApi.apiRequest.mock.calls.filter(
        ([path, options]) => path === "/admin/users" && !options,
      ),
    ).toHaveLength(2);
  });

  it("restricts an AdminAssistant to assignable roles and permissions while editing", async () => {
    setActor("AdminAssistant", ["ManageUsers"]);
    const superAdmin = adminUser(1, {
      fullName: "Super User",
      role: "SuperAdmin",
    });
    const assistant = adminUser(2, {
      fullName: "Assistant User",
      permissions: ["ManageUsers"],
    });
    let users = [superAdmin, assistant];
    ownerApi.apiRequest.mockImplementation(
      (path: string, options?: RequestInit) => {
        if (path === "/admin/properties") return Promise.resolve([]);
        if (path === "/admin/users" && !options) {
          return Promise.resolve(users);
        }
        if (path === "/admin/users/2" && options?.method === "PUT") {
          const saved = {
            ...assistant,
            firstName: "Edited",
            fullName: "Edited User",
          };
          users = [superAdmin, saved];
          return Promise.resolve(saved);
        }
        return Promise.reject(new Error("Unexpected request: " + path));
      },
    );
    render(<AdminUsersPage />);

    await screen.findByText("Super User");
    fireEvent.click(
      screen.getByRole("tab", { name: "اعضای اقامتگاه‌ها" }),
    );
    expect(
      screen.getByText(
        "برای مشاهده فهرست اقامتگاه‌ها، مجوز مدیریت اقامتگاه‌ها لازم است.",
      ),
    ).toBeTruthy();
    expect(ownerApi.apiRequest).not.toHaveBeenCalledWith("/admin/properties");
    fireEvent.click(
      screen.getByRole("tab", { name: "کاربران مدیریتی سامانه" }),
    );
    const superRow = screen.getByText("Super User").closest("tr")!;
    expect(
      within(superRow).queryByTitle("ویرایش کاربر"),
    ).toBeNull();
    const assistantRow = screen.getByText("Assistant User").closest("tr")!;
    fireEvent.click(within(assistantRow).getByTitle("ویرایش کاربر"));

    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByRole("heading", { name: "ویرایش مدیر سامانه" }),
    ).toBeTruthy();
    const roleSelect = within(dialog).getByRole("combobox");
    expect(within(roleSelect).getAllByRole("option")).toHaveLength(1);
    expect(
      within(roleSelect).getByRole("option", { name: "دستیار مدیر" }),
    ).toBeTruthy();
    fireEvent.change(input("#admin-user-first-name"), {
      target: { value: "Edited" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "ادامه" }));
    expect(within(dialog).getByLabelText("مدیریت کاربران")).toBeTruthy();
    expect(within(dialog).queryByLabelText("مدیریت نقش‌ها")).toBeNull();
    fireEvent.click(within(dialog).getByRole("button", { name: "ادامه" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "ذخیره" }));

    await waitFor(() =>
      expect(ownerApi.apiRequest).toHaveBeenCalledWith(
        "/admin/users/2",
        expect.objectContaining({ method: "PUT" }),
      ),
    );
    expect(await screen.findByText("Edited User")).toBeTruthy();
  });

  it("activates and confirms deactivation without optimistic state drift", async () => {
    let current = adminUser(2, {
      fullName: "Status User",
      isActive: false,
    });
    ownerApi.apiRequest.mockImplementation(
      (path: string, options?: RequestInit) => {
        if (path === "/admin/properties") return Promise.resolve([]);
        if (path === "/admin/users" && !options) {
          return Promise.resolve([current]);
        }
        if (path === "/admin/users/2/activate" && options?.method === "PUT") {
          current = { ...current, isActive: true };
          return Promise.resolve(current);
        }
        if (
          path === "/admin/users/2/deactivate" &&
          options?.method === "PUT"
        ) {
          current = { ...current, isActive: false };
          return Promise.resolve(current);
        }
        return Promise.reject(new Error("Unexpected request: " + path));
      },
    );
    render(<AdminUsersPage />);

    const row = (await screen.findByText("Status User")).closest("tr")!;
    fireEvent.click(
      within(row).getByRole("button", { name: "فعال‌سازی کاربر" }),
    );
    await waitFor(() =>
      expect(ownerApi.apiRequest).toHaveBeenCalledWith(
        "/admin/users/2/activate",
        { method: "PUT" },
      ),
    );
    expect(within(row).getByText("فعال")).toBeTruthy();

    fireEvent.click(within(row).getByTitle("غیرفعال‌سازی کاربر"));
    const confirmation = await screen.findByRole("alertdialog");
    fireEvent.click(
      within(confirmation).getByRole("button", { name: "غیرفعال شود" }),
    );
    await waitFor(() =>
      expect(ownerApi.apiRequest).toHaveBeenCalledWith(
        "/admin/users/2/deactivate",
        { method: "PUT" },
      ),
    );
    expect(within(row).getByText("غیرفعال")).toBeTruthy();
  });

  it("keeps the current row state when a confirmed mutation fails", async () => {
    const user = adminUser(2, { fullName: "Failure User" });
    ownerApi.apiRequest.mockImplementation(
      (path: string, options?: RequestInit) => {
        if (path === "/admin/properties") return Promise.resolve([]);
        if (path === "/admin/users" && !options) {
          return Promise.resolve([user]);
        }
        if (
          path === "/admin/users/2/deactivate" &&
          options?.method === "PUT"
        ) {
          return Promise.reject(new Error("تغییر وضعیت مجاز نیست"));
        }
        return Promise.reject(new Error("Unexpected request: " + path));
      },
    );
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    render(<AdminUsersPage />);

    const row = (await screen.findByText("Failure User")).closest("tr")!;
    fireEvent.click(within(row).getByTitle("غیرفعال‌سازی کاربر"));
    const confirmation = await screen.findByRole("alertdialog");
    fireEvent.click(
      within(confirmation).getByRole("button", { name: "غیرفعال شود" }),
    );

    expect(await screen.findByText("تغییر وضعیت مجاز نیست")).toBeTruthy();
    expect(within(row).getByText("فعال")).toBeTruthy();
    expect(notifications.success).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("selects a property and navigates to its canonical member management page", async () => {
    ownerApi.apiRequest.mockImplementation((path: string) => {
      if (path === "/admin/users") return Promise.resolve([]);
      if (path === "/admin/properties") {
        return Promise.resolve([
          property(42, {
            name: "خانه تاریخی کاشان",
            city: "کاشان",
            ownerName: "سارا محمدی",
          }),
        ]);
      }
      return Promise.reject(new Error("Unexpected request: " + path));
    });

    render(<AdminUsersPage />);

    await waitFor(() =>
      expect(ownerApi.apiRequest).toHaveBeenCalledWith("/admin/properties"),
    );

    fireEvent.click(
      screen.getByRole("tab", { name: "اعضای اقامتگاه‌ها" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "اقامتگاه" }));
    fireEvent.click(screen.getByRole("button", { name: /خانه تاریخی کاشان/ }));
    fireEvent.click(
      screen.getByRole("button", { name: "مدیریت اعضای اقامتگاه" }),
    );

    expect(navigation.push).toHaveBeenCalledWith(
      "/admin/properties/42/users",
    );
    expect(
      ownerApi.apiRequest.mock.calls.some(
        ([path]) => path === "/admin/properties/42/users",
      ),
    ).toBe(false);
  });
});
