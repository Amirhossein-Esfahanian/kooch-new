import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  request: vi.fn(),
  success: vi.fn(),
  user: { userId: 4, fullName: "مدیر آزمون" },
  session: { authenticated: true, loading: false, workspaces: ["admin"], platformRole: "SuperAdmin", platformPermissions: [] as string[] },
}));
vi.mock("@/lib/owner-api", () => ({ apiRequest: mocks.request }));
vi.mock("sonner", () => ({ toast: { success: mocks.success } }));
vi.mock("@/components/auth/AuthSessionProvider", () => ({ useAuthSession: () => ({ user: mocks.user, ...mocks.session }) }));
vi.mock("@/components/dashboard/DashboardLayouts", () => ({
  AdminLayout: ({ children, requiredPlatformPermission }: { children: React.ReactNode; requiredPlatformPermission: string }) => <div data-permission={requiredPlatformPermission}>{children}</div>,
}));
vi.mock("@/components/KoochDialog", () => ({
  KoochDialog: ({ children, open, title }: { children: React.ReactNode; open: boolean; title: string }) => open ? <div role="dialog" aria-label={title}>{children}</div> : null,
}));

import AdminTasksPage from "@/app/admin/tasks/page";

const tasks = [
  { id: 7, title: "پیگیری رزرو", description: "با اقامتگاه هماهنگ شود", priority: "High", dueAtUtc: "2026-10-19T09:00:00Z", createdByUserId: 9, assignedToUserId: 4, reservationId: 12, status: "Open", resolutionNote: null, createdAtUtc: "2026-10-18T09:00:00Z", updatedAtUtc: null, completedAtUtc: null, changes: [] },
  { id: 8, title: "گزارش شیفت", description: null, priority: "Normal", dueAtUtc: null, createdByUserId: 4, assignedToUserId: 6, reservationId: null, status: "Done", resolutionNote: null, createdAtUtc: "2026-10-18T08:00:00Z", updatedAtUtc: null, completedAtUtc: null, changes: [] },
];
const detail = { ...tasks[0], changes: [{ id: 1, actorDisplayName: "مدیر قبلی", changeType: "Created", occurredAtUtc: "2026-10-18T09:00:00Z", previousStatus: null, newStatus: "Open", previousAssigneeUserId: null, newAssigneeUserId: 4, resolutionNote: null }] };
const assignees = [{ id: 4, displayName: "مدیر آزمون" }, { id: 6, displayName: "مدیر دوم" }];

describe("Admin tasks", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", "/admin/tasks");
    mocks.request.mockReset();
    mocks.success.mockReset();
    mocks.session.platformRole = "SuperAdmin";
    mocks.session.platformPermissions = [];
    mocks.request.mockImplementation(async (path: string) => path === "/admin/tasks" ? tasks : path === "/admin/tasks/assignees" ? assignees : path === "/admin/tasks/7" ? detail : (() => { throw new Error(path); })());
  });

  it("opens creation from a reservation link and preselects the verified reservation", async () => {
    window.history.replaceState({}, "", "/admin/tasks?reservationId=12");
    mocks.request.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === "/admin/tasks/assignees") return assignees;
      if (path === "/admin/tasks" && init?.method === "POST") return tasks[0];
      if (path === "/admin/tasks") return tasks;
      if (path === "/admin/reservations/12") return { id: 12, reservationNumber: "R-123456", propertyName: "اقامتگاه آزمون" };
      throw new Error(path);
    });
    render(<AdminTasksPage />);
    const dialog = await screen.findByRole("dialog", { name: "ایجاد کار" });
    await waitFor(() => expect((within(dialog).getByLabelText("رزرو مرتبط") as HTMLSelectElement).value).toBe("12"));
    expect(mocks.request).toHaveBeenCalledWith("/admin/reservations/12");
    fireEvent.change(within(dialog).getByLabelText(/عنوان/), { target: { value: "پیگیری رزرو" } });
    fireEvent.change(within(dialog).getByLabelText(/مسئول کار/), { target: { value: "4" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "ایجاد کار" }));
    await waitFor(() => expect(mocks.request).toHaveBeenCalledWith("/admin/tasks", {
      method: "POST", body: expect.stringContaining('"reservationId":12'),
    }));
  });

  it("shows assigned and created scopes with status filtering and linked reservation", async () => {
    const { container } = render(<AdminTasksPage />);
    expect(container.querySelector('[data-permission="ManageReservations"]')).toBeTruthy();
    expect(await screen.findByText("پیگیری رزرو")).toBeTruthy();
    expect(screen.queryByText("گزارش شیفت")).toBeNull();
    expect(screen.getByRole("link", { name: /رزرو/ }).getAttribute("href")).toBe("/admin/reservations?reservationId=12");
    fireEvent.change(screen.getByLabelText("وضعیت"), { target: { value: "Done" } });
    expect(screen.queryByText("پیگیری رزرو")).toBeNull();
    expect(screen.getByText(/کاری با این وضعیت/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "ایجادشده توسط من" }));
    expect(screen.getByText("گزارش شیفت")).toBeTruthy();
  });

  it("loads history and submits a changed status with optional trimmed note", async () => {
    mocks.request.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === "/admin/tasks") return tasks;
      if (path === "/admin/tasks/assignees") return assignees;
      if (path === "/admin/tasks/7") return detail;
      if (path === "/admin/tasks/7/status" && init?.method === "PUT") return { ...detail, status: "Done", resolutionNote: "پیگیری شد" };
      throw new Error(path);
    });
    render(<AdminTasksPage />);
    fireEvent.click(await screen.findByRole("button", { name: "جزئیات پیگیری رزرو" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("مدیر قبلی", { exact: false })).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: "ثبت وضعیت" }).hasAttribute("disabled")).toBe(true);
    fireEvent.change(within(dialog).getByLabelText("وضعیت جدید"), { target: { value: "Done" } });
    fireEvent.change(within(dialog).getByLabelText("یادداشت نتیجه (اختیاری)"), { target: { value: "  پیگیری شد  " } });
    fireEvent.click(within(dialog).getByRole("button", { name: "ثبت وضعیت" }));
    await waitFor(() => expect(mocks.request).toHaveBeenCalledWith("/admin/tasks/7/status", {
      method: "PUT", body: JSON.stringify({ status: "Done", resolutionNote: "پیگیری شد" }),
    }));
    expect(await within(dialog).findByText("پیگیری شد")).toBeTruthy();
  });

  it("offers retry after load failure", async () => {
    mocks.request.mockImplementationOnce(async () => { throw new Error("خطای دریافت"); });
    render(<AdminTasksPage />);
    expect(await screen.findByText("خطای دریافت")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "تلاش دوباره" }));
    expect(await screen.findByText("پیگیری رزرو")).toBeTruthy();
  });

  it("does not request tasks without Admin reservation permission", () => {
    mocks.session.platformRole = "AdminAssistant";
    mocks.session.platformPermissions = [];
    render(<AdminTasksPage />);
    expect(mocks.request).not.toHaveBeenCalled();
    mocks.session.platformRole = "SuperAdmin";
  });

  it("creates a task with selected Admin and reservation, then refreshes the created scope", async () => {
    mocks.request.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === "/admin/tasks/assignees") return assignees;
      if (path === "/admin/tasks" && init?.method === "POST") return { ...tasks[0], id: 9, assignedToUserId: 6, createdByUserId: 4 };
      if (path === "/admin/tasks") return tasks;
      if (path.startsWith("/admin/reservations?")) return { items: [{ reservationId: 12, reservationNumber: "R-123456", propertyName: "اقامتگاه آزمون" }] };
      throw new Error(path);
    });
    render(<AdminTasksPage />);
    fireEvent.click(screen.getByRole("button", { name: "ایجاد کار" }));
    const dialog = screen.getByRole("dialog", { name: "ایجاد کار" });
    await waitFor(() => expect(within(dialog).getByRole("option", { name: "مدیر دوم" })).toBeTruthy());
    fireEvent.change(within(dialog).getByLabelText(/عنوان/), { target: { value: "  هماهنگی شیفت  " } });
    fireEvent.change(within(dialog).getByLabelText("شرح"), { target: { value: "  تماس با اقامتگاه  " } });
    fireEvent.change(within(dialog).getByLabelText(/اولویت/), { target: { value: "High" } });
    fireEvent.change(within(dialog).getByLabelText(/مسئول کار/), { target: { value: "6" } });
    fireEvent.change(within(dialog).getByLabelText("جستجوی رزرو (اختیاری)"), { target: { value: "R-123456" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "جستجوی رزرو" }));
    await waitFor(() => expect(within(dialog).getByRole("option", { name: /R-123456/ })).toBeTruthy());
    fireEvent.change(within(dialog).getByLabelText("رزرو مرتبط"), { target: { value: "12" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "ایجاد کار" }));
    await waitFor(() => expect(mocks.request).toHaveBeenCalledWith("/admin/tasks", {
      method: "POST", body: JSON.stringify({ title: "هماهنگی شیفت", description: "تماس با اقامتگاه", priority: "High", dueAtUtc: null, assignedToUserId: 6, reservationId: 12 }),
    }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "ایجاد کار" })).toBeNull());
    expect(screen.getByRole("button", { name: "ایجادشده توسط من" }).getAttribute("aria-pressed")).toBe("true");
    expect(mocks.request.mock.calls.filter(([path]) => path === "/admin/tasks").length).toBeGreaterThan(1);
  });

  it("reassigns from details, refreshes the list, and keeps API errors visible", async () => {
    mocks.request.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === "/admin/tasks/assignees") return assignees;
      if (path === "/admin/tasks") return tasks;
      if (path === "/admin/tasks/7") return detail;
      if (path === "/admin/tasks/7/assignee" && init?.method === "PUT") throw new Error("دسترسی به رزرو کافی نیست");
      throw new Error(path);
    });
    render(<AdminTasksPage />);
    fireEvent.click(await screen.findByRole("button", { name: "جزئیات پیگیری رزرو" }));
    const dialog = await screen.findByRole("dialog", { name: "پیگیری رزرو" });
    await waitFor(() => expect(within(dialog).getByRole("option", { name: "مدیر دوم" })).toBeTruthy());
    fireEvent.change(within(dialog).getByLabelText("مسئول جدید"), { target: { value: "6" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "تغییر مسئول" }));
    await waitFor(() => expect(mocks.request).toHaveBeenCalledWith("/admin/tasks/7/assignee", {
      method: "PUT", body: JSON.stringify({ assignedToUserId: 6 }),
    }));
    expect(await within(dialog).findByText("دسترسی به رزرو کافی نیست")).toBeTruthy();
    mocks.request.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === "/admin/tasks/7/assignee" && init?.method === "PUT") return { ...detail, assignedToUserId: 6, changes: [...detail.changes, { ...detail.changes[0], id: 2, changeType: "Reassigned", newAssigneeUserId: 6 }] };
      if (path === "/admin/tasks") return tasks;
      if (path === "/admin/tasks/assignees") return assignees;
      return detail;
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "تغییر مسئول" }));
    expect(await within(dialog).findByText("تغییر مسئول", { exact: true, selector: "span" })).toBeTruthy();
    await waitFor(() => expect(mocks.success).toHaveBeenCalledWith("مسئول کار تغییر کرد."));
  });
});
