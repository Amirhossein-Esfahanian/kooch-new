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

function taskResponse(items = [
  { id: 11, title: "پیگیری رزرو", priority: "High", status: "Open", dueAtUtc: "2026-10-21T09:00:00Z" },
  { id: 12, title: "هماهنگی شیفت", priority: "Normal", status: "InProgress", dueAtUtc: null },
], totalCount = items.length) {
  return { items, totalCount, page: 1, pageSize: 5, totalPages: Math.ceil(totalCount / 5) };
}

describe("Admin dashboard V1", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.role = "AdminAssistant";
    mocks.permissions = ["ViewDashboard", "ManageProperties", "ManageUsers"];
    mocks.apiRequest.mockImplementation((path: string) => Promise.resolve(
      path.startsWith("/admin/tasks/") ? taskResponse() : response(),
    ));
  });

  it("guards with ViewDashboard and renders only API counts and pending-review properties", async () => {
    render(<AdminDashboardPage />);
    expect(await screen.findByText("اقامتگاه سرو")).toBeTruthy();
    expect(mocks.guard).toHaveBeenCalledWith("ViewDashboard");
    expect(mocks.apiRequest).toHaveBeenCalledWith("/admin/dashboard", expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(mocks.apiRequest).not.toHaveBeenCalledWith(
      "/admin/tasks/mine/unfinished?page=1&pageSize=5", expect.anything());
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
    mocks.permissions = ["ManageReservations"];
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

  it("shows only the API-ordered five-task preview and authoritative total for ManageReservations", async () => {
    mocks.permissions.push("ManageReservations");
    const items = [
      { id: 1, title: "کار اول", priority: "High", status: "Open", dueAtUtc: "2026-10-21T09:00:00Z" },
      { id: 2, title: "کار دوم", priority: "Normal", status: "InProgress", dueAtUtc: null },
      { id: 3, title: "کار سوم", priority: "Low", status: "Open", dueAtUtc: null },
      { id: 4, title: "کار چهارم", priority: "High", status: "Open", dueAtUtc: null },
      { id: 5, title: "کار پنجم", priority: "Normal", status: "InProgress", dueAtUtc: null },
      { id: 6, title: "کار ششم", priority: "Low", status: "Open", dueAtUtc: null },
    ];
    mocks.apiRequest.mockImplementation((path: string) => Promise.resolve(
      path.startsWith("/admin/tasks/") ? taskResponse(items, 17) : response(),
    ));
    render(<AdminDashboardPage />);

    const section = await screen.findByRole("region", { name: "کارهای نیازمند اقدام" });
    await waitFor(() => expect(within(section).getByText("تعداد کل کارهای نیازمند اقدام: ۱۷")).toBeTruthy());
    expect(mocks.apiRequest).toHaveBeenCalledWith(
      "/admin/tasks/mine/unfinished?page=1&pageSize=5", expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(within(section).getAllByRole("listitem").map((row) => row.querySelector("a")?.textContent))
      .toEqual(["کار اول", "کار دوم", "کار سوم", "کار چهارم", "کار پنجم"]);
    expect(within(section).queryByText("کار ششم")).toBeNull();
    expect(within(section).getAllByText("اولویت زیاد")).toHaveLength(2);
    expect(within(section).getAllByText("در حال انجام")).toHaveLength(2);
    expect(within(section).getByText(/سررسید:/)).toBeTruthy();
    expect(within(section).getByRole("link", { name: "مشاهده همه کارها" }).getAttribute("href")).toBe("/admin/tasks");
    expect(within(section).getByRole("link", { name: "کار اول" }).getAttribute("href")).toBe("/admin/tasks");
  });

  it("keeps dashboard metrics visible while tasks load, then shows a genuine empty state", async () => {
    mocks.permissions.push("ManageReservations");
    let resolveTasks!: (value: ReturnType<typeof taskResponse>) => void;
    mocks.apiRequest.mockImplementation((path: string) => path.startsWith("/admin/tasks/")
      ? new Promise<ReturnType<typeof taskResponse>>((resolve) => { resolveTasks = resolve; })
      : Promise.resolve(response()));
    render(<AdminDashboardPage />);
    const section = screen.getByRole("region", { name: "کارهای نیازمند اقدام" });
    expect(within(section).getByRole("status").textContent).toContain("در حال دریافت کارهای شما");
    expect(await screen.findByText("اقامتگاه سرو")).toBeTruthy();
    resolveTasks(taskResponse([], 0));
    expect(await within(section).findByText("کاری برای اقدام ندارید.")).toBeTruthy();
    expect(within(section).getByText("تعداد کل کارهای نیازمند اقدام: ۰")).toBeTruthy();
  });

  it("isolates task API errors, retries only tasks, and handles a task-specific 403", async () => {
    mocks.permissions.push("ManageReservations");
    mocks.apiRequest.mockImplementation((path: string) => path.startsWith("/admin/tasks/")
      ? Promise.reject(new Error("offline")) : Promise.resolve(response()));
    render(<AdminDashboardPage />);
    const section = screen.getByRole("region", { name: "کارهای نیازمند اقدام" });
    expect(await within(section).findByText("کارها بارگذاری نشدند")).toBeTruthy();
    expect(screen.getByText("اقامتگاه سرو")).toBeTruthy();
    expect(within(section).queryByText("پیگیری رزرو")).toBeNull();
    mocks.apiRequest.mockImplementation((path: string) => Promise.resolve(
      path.startsWith("/admin/tasks/") ? taskResponse() : response(),
    ));
    fireEvent.click(within(section).getByRole("button", { name: "تلاش دوباره برای کارها" }));
    expect(await within(section).findByText("پیگیری رزرو")).toBeTruthy();
    expect(mocks.apiRequest.mock.calls.filter(([path]) => path === "/admin/dashboard")).toHaveLength(1);

    mocks.apiRequest.mockImplementation((path: string) => path.startsWith("/admin/tasks/")
      ? Promise.reject(new ApiRequestError("Forbidden", 403)) : Promise.resolve(response()));
    const view = render(<AdminDashboardPage />);
    const forbidden = within(view.container).getByRole("region", { name: "کارهای نیازمند اقدام" });
    expect(await within(forbidden).findByText("دسترسی به کارها ندارید")).toBeTruthy();
    expect(within(forbidden).queryByRole("button", { name: "تلاش دوباره برای کارها" })).toBeNull();
    view.unmount();
  });
});
