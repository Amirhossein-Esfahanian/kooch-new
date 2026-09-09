import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const ownerApi = vi.hoisted(() => ({
  apiRequest: vi.fn(),
}));

const navigation = vi.hoisted(() => ({
  push: vi.fn(),
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

import AdminPropertyMembersPage from "@/app/admin/property-members/page";

beforeEach(() => {
  vi.clearAllMocks();
  auth.current = {
    authenticated: true,
    loading: false,
    platformRole: "SuperAdmin",
    platformPermissions: [],
    workspaces: ["admin"],
  };
});

describe("Admin property members entry page", () => {
  it("selects a property and navigates to canonical member management", async () => {
    ownerApi.apiRequest.mockResolvedValue([
      {
        id: 42,
        name: "خانه تاریخی کاشان",
        city: "کاشان",
        ownerName: "سارا محمدی",
        ownerEmail: "owner@example.test",
      },
    ]);

    render(<AdminPropertyMembersPage />);

    expect(
      screen.getByRole("heading", { name: "اعضای اقامتگاه‌ها", level: 1 }),
    ).toBeTruthy();
    expect(
      document.querySelector('[data-required-permission="ManageUsers"]'),
    ).toBeTruthy();
    expect(
      screen.getByText(
        "مالک اقامتگاه از مسیر انتقال مالکیت تعیین می‌شود و از فرم افزودن عضو قابل تغییر نیست.",
      ),
    ).toBeTruthy();
    await waitFor(() =>
      expect(ownerApi.apiRequest).toHaveBeenCalledWith("/admin/properties"),
    );

    fireEvent.click(
      screen.getByRole("button", { name: "مدیریت / انتقال مالکیت" }),
    );
    expect(navigation.push).toHaveBeenCalledWith("/admin/properties");
    navigation.push.mockClear();

    fireEvent.click(screen.getByRole("button", { name: "اقامتگاه" }));
    fireEvent.click(
      screen.getByRole("button", { name: /خانه تاریخی کاشان/ }),
    );
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

  it("explains the additional property permission requirement", () => {
    auth.current = {
      authenticated: true,
      loading: false,
      platformRole: "AdminAssistant",
      platformPermissions: ["ManageUsers"],
      workspaces: ["admin"],
    };

    render(<AdminPropertyMembersPage />);

    expect(
      screen.getByText(
        "برای انتخاب اقامتگاه، مجوز مدیریت اقامتگاه‌ها نیز لازم است.",
      ),
    ).toBeTruthy();
    expect(ownerApi.apiRequest).not.toHaveBeenCalled();
  });
});
