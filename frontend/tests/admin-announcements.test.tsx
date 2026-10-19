import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  request: vi.fn(), success: vi.fn(),
  session: { authenticated: true, loading: false, workspaces: ["admin"], platformRole: "SuperAdmin", platformPermissions: [] as string[] },
}));
vi.mock("@/lib/owner-api", () => ({ apiRequest: mocks.request }));
vi.mock("sonner", () => ({ toast: { success: mocks.success } }));
vi.mock("@/components/auth/AuthSessionProvider", () => ({ useAuthSession: () => ({ ...mocks.session, user: { userId: 4, fullName: "مدیر آزمون" } }) }));
vi.mock("@/components/dashboard/DashboardLayouts", () => ({
  AdminLayout: ({ children, requiredPlatformPermission }: { children: React.ReactNode; requiredPlatformPermission: string }) =>
    <div data-permission={requiredPlatformPermission}>{children}</div>,
}));
vi.mock("@/components/KoochDialog", () => ({
  KoochDialog: ({ children, open, title }: { children: React.ReactNode; open: boolean; title: string }) =>
    open ? <div role="dialog" aria-label={title}>{children}</div> : null,
}));
vi.mock("@/components/KoochConfirmDialog", () => ({
  KoochConfirmDialog: ({ open, title, onConfirm }: { open: boolean; title: string; onConfirm: () => void }) =>
    open ? <div role="alertdialog" aria-label={title}><button onClick={onConfirm}>تأیید ارسال</button></div> : null,
}));

import AdminAnnouncementsPage from "@/app/admin/announcements/page";

const admins = [
  { id: 4, fullName: "مدیر آزمون", isActive: true },
  { id: 5, fullName: "مدیر دوم", isActive: true },
];
const history = [{ id: 9, title: "اطلاعیه پیشین", body: "متن", target: "AllAdmins", senderUserId: 4, sentAtUtc: "2026-10-18T09:00:00Z", recipientCount: 2, recipientUserIds: [4, 5] }];

describe("Admin announcements", () => {
  beforeEach(() => {
    mocks.request.mockReset(); mocks.success.mockReset();
    mocks.session.platformRole = "SuperAdmin"; mocks.session.platformPermissions = [];
    mocks.request.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === "/admin/announcements" && init?.method === "POST") return history[0];
      if (path === "/admin/announcements") return history;
      if (path.startsWith("/admin/announcements/recipients?")) {
        const target = new URLSearchParams(path.split("?")[1]).get("target");
        return target === "SelectedAdmins"
          ? { items: admins.map((user) => ({ id: user.id, displayName: user.fullName })), totalPages: 1 }
          : { items: [{ id: 18, displayName: "مالک آزمون" }], totalPages: 1 };
      }
      throw new Error(path);
    });
  });

  it("guards with ManageNotifications and shows sent history", async () => {
    render(<AdminAnnouncementsPage />);
    expect(document.querySelector("[data-permission] ")?.getAttribute("data-permission")).toBe("ManageNotifications");
    expect(await screen.findByText("اطلاعیه پیشین")).toBeTruthy();
    expect(screen.getByText(/۲ گیرنده/)).toBeTruthy();
    expect(screen.getByText(/فرستنده: مدیر آزمون/)).toBeTruthy();
  });

  it("uses the permission-scoped lookup for selected Admins and Property Owners", async () => {
    render(<AdminAnnouncementsPage />);
    fireEvent.click(screen.getByRole("button", { name: "ایجاد اعلان" }));
    const dialog = screen.getByRole("dialog", { name: "ایجاد اعلان" });
    expect(await within(dialog).findByText("مدیر دوم")).toBeTruthy();
    fireEvent.change(within(dialog).getByRole("combobox", { name: /گیرندگان/ }), { target: { value: "SelectedPropertyOwners" } });
    expect(await within(dialog).findByText("مالک آزمون")).toBeTruthy();
    expect(mocks.request.mock.calls.some(([path]) => String(path).startsWith("/admin/announcements/recipients?target=SelectedPropertyOwners"))).toBe(true);
  });

  it("confirms a broadcast, sends exact contract and refreshes history", async () => {
    render(<AdminAnnouncementsPage />);
    fireEvent.click(screen.getByRole("button", { name: "ایجاد اعلان" }));
    const dialog = screen.getByRole("dialog", { name: "ایجاد اعلان" });
    fireEvent.change(within(dialog).getByLabelText(/عنوان/), { target: { value: "  خبر مهم  " } });
    fireEvent.change(within(dialog).getByLabelText(/متن اعلان/), { target: { value: "  متن پیام  " } });
    fireEvent.change(within(dialog).getByRole("combobox", { name: /گیرندگان/ }), { target: { value: "AllAdmins" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "بررسی و ارسال" }));
    expect(mocks.request.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "تأیید ارسال" }));
    await waitFor(() => expect(mocks.request.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1));
    const body = JSON.parse(mocks.request.mock.calls.find(([, init]) => init?.method === "POST")?.[1]?.body as string);
    expect(body).toMatchObject({ title: "خبر مهم", body: "متن پیام", target: "AllAdmins", recipientUserIds: [] });
    expect(body.idempotencyKey).toBeTruthy();
    await waitFor(() => expect(mocks.request.mock.calls.filter(([path, init]) => path === "/admin/announcements" && !init)).toHaveLength(2));
  });

  it("sends only selected canonical User IDs without broadcast confirmation", async () => {
    render(<AdminAnnouncementsPage />);
    fireEvent.click(screen.getByRole("button", { name: "ایجاد اعلان" }));
    const dialog = screen.getByRole("dialog", { name: "ایجاد اعلان" });
    fireEvent.change(within(dialog).getByLabelText(/عنوان/), { target: { value: "خبر" } });
    fireEvent.change(within(dialog).getByLabelText(/متن اعلان/), { target: { value: "پیام" } });
    fireEvent.click(await within(dialog).findByLabelText("مدیر دوم"));
    fireEvent.click(within(dialog).getByRole("button", { name: "ارسال اعلان" }));
    await waitFor(() => expect(mocks.request.mock.calls.some(([, init]) => init?.method === "POST")).toBe(true));
    const body = JSON.parse(mocks.request.mock.calls.find(([, init]) => init?.method === "POST")?.[1]?.body as string);
    expect(body).toMatchObject({ target: "SelectedAdmins", recipientUserIds: [5] });
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("lets a ManageNotifications-only Admin select an Owner and retry with the same key", async () => {
    mocks.session.platformRole = "AdminAssistant";
    mocks.session.platformPermissions = ["ManageNotifications"];
    const keys: string[] = [];
    mocks.request.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === "/admin/announcements" && init?.method === "POST") {
        keys.push(JSON.parse(init.body as string).idempotencyKey);
        if (keys.length === 1) throw new Error("ارسال انجام نشد");
        return history[0];
      }
      if (path === "/admin/announcements") return history;
      if (path.startsWith("/admin/announcements/recipients?")) {
        const target = new URLSearchParams(path.split("?")[1]).get("target");
        return target === "SelectedAdmins"
          ? { items: admins.map((item) => ({ id: item.id, displayName: item.fullName })), totalPages: 1 }
          : { items: [{ id: 18, displayName: "مالک آزمون" }], totalPages: 1 };
      }
      throw new Error(`Unauthorized lookup: ${path}`);
    });
    render(<AdminAnnouncementsPage />);
    fireEvent.click(screen.getByRole("button", { name: "ایجاد اعلان" }));
    expect(await screen.findByLabelText("مدیر دوم")).toBeTruthy();
    expect(mocks.request.mock.calls.every(([path]) => path === "/admin/announcements" || String(path).startsWith("/admin/announcements/recipients?"))).toBe(true);
    const dialog = screen.getByRole("dialog", { name: "ایجاد اعلان" });
    fireEvent.change(within(dialog).getByLabelText(/عنوان/), { target: { value: "خبر" } });
    fireEvent.change(within(dialog).getByLabelText(/متن اعلان/), { target: { value: "پیام" } });
    fireEvent.change(within(dialog).getByRole("combobox", { name: /گیرندگان/ }), { target: { value: "SelectedPropertyOwners" } });
    fireEvent.click(await within(dialog).findByLabelText("مالک آزمون"));
    fireEvent.click(within(dialog).getByRole("button", { name: "ارسال اعلان" }));
    expect(await screen.findByText("ارسال انجام نشد")).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "ارسال اعلان" }));
    await waitFor(() => expect(keys).toHaveLength(2));
    expect(keys[0]).toBe(keys[1]);
    expect(mocks.request.mock.calls.filter(([path]) => path === "/admin/users" || String(path).startsWith("/admin/property-members"))).toHaveLength(0);
  });
});
