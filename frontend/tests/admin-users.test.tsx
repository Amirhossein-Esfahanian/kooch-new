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
import type { AdminUserResponse } from "@/lib/owner-api";

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
    const breadcrumb = screen.getByRole("navigation", {
      name: "مسیر صفحه",
    });
    expect(
      within(breadcrumb)
        .getByRole("link", { name: "پنل مدیریت" })
        .getAttribute("href"),
    ).toBe("/admin");
    expect(
      within(breadcrumb)
        .getByText("کاربران مدیریتی سامانه")
        .getAttribute("aria-current"),
    ).toBe("page");
    expect(
      within(breadcrumb).queryByRole("link", {
        name: "کاربران مدیریتی سامانه",
      }),
    ).toBeNull();
    expect(
      screen.getByText("مدیریت مدیران ارشد و دستیاران مدیریتی سامانه"),
    ).toBeTruthy();
    expect(
      screen.queryByRole("heading", {
        name: "مدیران سامانه",
        level: 2,
      }),
    ).toBeNull();
    expect(
      screen.queryByText(
        "مدیران ارشد و دستیاران مدیریتی با دسترسی سراسری سامانه",
      ),
    ).toBeNull();
    const addButton = screen.getByRole("button", {
      name: "افزودن مدیر سامانه",
    });
    expect(addButton.querySelector('[aria-hidden="true"]')).not.toBeNull();
    expect(screen.queryByRole("tab")).toBeNull();
    expect(ownerApi.apiRequest).not.toHaveBeenCalledWith("/admin/properties");

    resolveUsers([adminUser(1)]);
    expect(await screen.findByText("Test User 1")).toBeTruthy();
    const filterCard = screen.getByLabelText("جستجو").closest("section")!;
    expect(within(filterCard).getByText("۱ کاربر")).toBeTruthy();
    expect(
      document.querySelector('[data-required-permission="ManageUsers"]'),
    ).toBeTruthy();
  });

  it("shows filtered and total user counts inside the filter card", async () => {
    ownerApi.apiRequest.mockResolvedValue([
      adminUser(1, { fullName: "Super User", role: "SuperAdmin" }),
      adminUser(2, { fullName: "Assistant User" }),
    ]);

    render(<AdminUsersPage />);

    await screen.findByText("Super User");
    const filterCard = screen.getByLabelText("جستجو").closest("section")!;
    expect(within(filterCard).getByText("۲ کاربر")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("نقش"), {
      target: { value: "SuperAdmin" },
    });

    expect(within(filterCard).getByText("نمایش ۱ از ۲ کاربر")).toBeTruthy();
    expect(within(filterCard).getByText("فیلتر فعال است")).toBeTruthy();
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
    expect(ownerApi.apiRequest).not.toHaveBeenCalledWith("/admin/properties");
    const superRow = screen.getByText("Super User").closest("tr")!;
    expect(
      within(superRow).queryByTitle("ویرایش کاربر"),
    ).toBeNull();
    const assistantRow = screen.getByText("Assistant User").closest("tr")!;
    const editButton = within(assistantRow).getByRole("button", {
      name: "ویرایش کاربر",
    });
    expect(within(editButton).getByText("ویرایش")).toBeTruthy();
    fireEvent.click(editButton);

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
    const activateButton = within(row).getByRole("button", {
      name: "فعال‌سازی کاربر",
    });
    expect(within(activateButton).getByText("فعال‌سازی")).toBeTruthy();
    fireEvent.click(activateButton);
    await waitFor(() =>
      expect(ownerApi.apiRequest).toHaveBeenCalledWith(
        "/admin/users/2/activate",
        { method: "PUT" },
      ),
    );
    expect(within(row).getByText("فعال")).toBeTruthy();

    const deactivateButton = within(row).getByRole("button", {
      name: "غیرفعال‌سازی کاربر",
    });
    expect(within(deactivateButton).getByText("غیرفعال‌سازی")).toBeTruthy();
    fireEvent.click(deactivateButton);
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

});
