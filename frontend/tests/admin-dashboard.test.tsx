import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminDashboardResponse, PropertyResponse } from "@/lib/owner-api";

const mocks = vi.hoisted(() => ({
  apiRequest: vi.fn(),
  guard: vi.fn(),
  role: "AdminAssistant" as "AdminAssistant" | "SuperAdmin",
  permissions: ["ViewDashboard", "ManageProperties", "ManageUsers"] as string[],
}));

vi.mock("@/components/auth/AuthSessionProvider", () => ({
  useAuthSession: () => ({ platformRole: mocks.role, platformPermissions: mocks.permissions }),
}));
vi.mock("@/components/dashboard/DashboardLayouts", () => ({
  AdminLayout: ({ children, requiredPlatformPermission }: { children: ReactNode; requiredPlatformPermission?: string }) => {
    mocks.guard(requiredPlatformPermission);
    return <>{children}</>;
  },
}));
vi.mock("@/lib/owner-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/owner-api")>();
  return { ...actual, apiRequest: mocks.apiRequest };
});

import AdminDashboardPage from "@/app/admin/page";
import { ApiRequestError } from "@/lib/owner-api";

function response(): AdminDashboardResponse {
  return {
    totalProperties: 12,
    pendingProperties: 1,
    approvedProperties: 9,
    totalUsers: 45,
    totalOwners: 7,
    pendingPropertyItems: [{
      id: 21,
      name: "اقامتگاه سرو",
      ownerName: "مینا احمدی",
      destinationName: "کاشان",
    } as PropertyResponse],
  };
}

describe("Admin dashboard V1", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.role = "AdminAssistant";
    mocks.permissions = ["ViewDashboard", "ManageProperties", "ManageUsers"];
    mocks.apiRequest.mockResolvedValue(response());
  });

  it("guards with ViewDashboard and renders only API counts and pending-review properties", async () => {
    render(<AdminDashboardPage />);
    expect(await screen.findByText("اقامتگاه سرو")).toBeTruthy();
    expect(mocks.guard).toHaveBeenCalledWith("ViewDashboard");
    expect(mocks.apiRequest).toHaveBeenCalledWith("/admin/dashboard", expect.objectContaining({ signal: expect.any(AbortSignal) }));
    const stats = screen.getByRole("region", { name: "آمار داشبورد" });
    expect(within(stats).getByText("۱۲")).toBeTruthy();
    expect(within(stats).getByText("۱")).toBeTruthy();
    expect(within(stats).getByText("۹")).toBeTruthy();
    expect(within(stats).getByText("۴۵")).toBeTruthy();
    expect(within(stats).getByText("۷")).toBeTruthy();
    expect(screen.getByRole("link", { name: "بررسی اقامتگاه" }).getAttribute("href")).toBe("/admin/properties/21");
    expect(screen.queryByText(/درآمد امروز|نمودار رزروها|رزروهای اخیر|فعالیت‌های اخیر|پیام‌ها/)).toBeNull();
  });

  it("shows loading without counts, then a genuine empty pending-review state", async () => {
    let resolve!: (value: AdminDashboardResponse) => void;
    mocks.apiRequest.mockReturnValue(new Promise<AdminDashboardResponse>((next) => { resolve = next; }));
    render(<AdminDashboardPage />);
    expect(screen.getByRole("status").textContent).toContain("در حال دریافت");
    expect(screen.queryByText("۱۲")).toBeNull();
    resolve({ ...response(), pendingProperties: 0, pendingPropertyItems: [] });
    expect(await screen.findByText("اقامتگاهی در انتظار بررسی نیست.")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("fails closed on API failure and retries without fabricated widgets", async () => {
    mocks.apiRequest.mockRejectedValueOnce(new Error("offline"));
    render(<AdminDashboardPage />);
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.queryByText("اقامتگاه سرو")).toBeNull();
    expect(screen.queryByText("اقامتگاهی در انتظار بررسی نیست.")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "تلاش دوباره" }));
    expect(await screen.findByText("اقامتگاه سرو")).toBeTruthy();
    expect(mocks.apiRequest).toHaveBeenCalledTimes(2);
  });

  it("does not request data without ViewDashboard", () => {
    mocks.permissions = ["ManageProperties"];
    render(<AdminDashboardPage />);
    expect(screen.getByRole("alert").textContent).toContain("دسترسی به داشبورد ندارید");
    expect(mocks.apiRequest).not.toHaveBeenCalled();
    expect(mocks.guard).toHaveBeenCalledWith(undefined);
  });

  it("accepts SuperAdmin and omits links to lists without their separate permissions", async () => {
    mocks.role = "SuperAdmin";
    mocks.permissions = [];
    const view = render(<AdminDashboardPage />);
    expect(await screen.findByText("اقامتگاه سرو")).toBeTruthy();
    expect(mocks.guard).toHaveBeenCalledWith("ViewDashboard");
    view.unmount();

    mocks.role = "AdminAssistant";
    mocks.permissions = ["ViewDashboard"];
    render(<AdminDashboardPage />);
    await waitFor(() => expect(screen.getByText("اقامتگاه سرو")).toBeTruthy());
    expect(screen.queryByRole("link", { name: "بررسی اقامتگاه" })).toBeNull();
    expect(screen.queryByRole("link", { name: "مشاهده فهرست" })).toBeNull();
  });

  it("shows backend permission rejection without a retry that cannot succeed", async () => {
    mocks.apiRequest.mockRejectedValue(new ApiRequestError("Forbidden", 403));
    render(<AdminDashboardPage />);
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "تلاش دوباره" })).toBeNull();
    expect(screen.queryByText("اقامتگاه سرو")).toBeNull();
  });
});
