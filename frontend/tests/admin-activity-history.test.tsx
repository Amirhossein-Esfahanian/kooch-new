import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminAuditPage } from "@/lib/admin-audit-logs";

const mocks = vi.hoisted(() => ({ request: vi.fn(), guard: vi.fn(), permissions: ["ViewReports"] as string[] }));
vi.mock("@/components/auth/AuthSessionProvider", () => ({ useAuthSession: () => ({ authenticated: true,
  loading: false, workspaces: ["admin"], platformRole: "AdminAssistant", platformPermissions: mocks.permissions, user: { userId: 1 } }) }));
vi.mock("@/lib/owner-api", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/owner-api")>(), apiRequest: mocks.request,
}));
vi.mock("@/components/dashboard/DashboardLayouts", () => ({
  AdminLayout: ({ children, requiredPlatformPermission }: { children: ReactNode; requiredPlatformPermission: string }) => {
    mocks.guard(requiredPlatformPermission); return children;
  },
}));
vi.mock("@/components/KoochDatePicker", () => ({ KoochDatePicker: ({ label, value, onChange }: {
  label: string; value: string | null; onChange: (value: string | null) => void;
}) => <input aria-label={label} value={value ?? ""} onChange={(event) => onChange(event.target.value || null)} /> }));

import Page from "@/app/admin/activity-history/page";
import { ApiRequestError } from "@/lib/owner-api";

function result(): AdminAuditPage {
  return { items: [{ id: 1, userId: 5, actorDisplayName: "مدیر آزمون", action: "RoomCapacityChanged",
    occurredAtUtc: "2026-10-30T08:00:00Z", entityType: "RoomType", entityId: 20,
    propertyId: 10, propertyName: "اقامتگاه سرو", description: "Room capacity changed.",
    previousValues: { TotalInventory: 2 }, newValues: { TotalInventory: 3 } }],
    page: 1, pageSize: 25, totalCount: 26, totalPages: 2 };
}

describe("Admin activity history", () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.permissions = ["ViewReports"]; mocks.request.mockResolvedValue(result()); });

  it("uses Admin API and ViewReports, showing actor, target and allowed before/after values", async () => {
    render(<Page />);
    expect(await screen.findByText("مدیر آزمون")).toBeTruthy();
    expect(mocks.guard).toHaveBeenCalledWith("ViewReports");
    expect(mocks.request).toHaveBeenCalledWith("/admin/audit-logs?page=1&pageSize=25", expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(screen.getByText("اقامتگاه سرو")).toBeTruthy();
    expect(within(screen.getByRole("table")).getByText("تغییر ظرفیت اتاق")).toBeTruthy();
    expect(screen.getByText("موجودی کل")).toBeTruthy();
    expect(screen.getByText("قبل:").parentElement?.textContent).toContain("۲");
    expect(screen.getByText("بعد:").parentElement?.textContent).toContain("۳");
    expect(document.querySelector("time")?.getAttribute("datetime")).toBe("2026-10-30T08:00:00Z");
    expect(mocks.request.mock.calls.some(([path]) => path.startsWith("/owner/"))).toBe(false);
  });

  it("applies actor, Property, action and inclusive UTC date filters without browser date shifting", async () => {
    render(<Page />); await screen.findByText("مدیر آزمون");
    fireEvent.change(screen.getByLabelText("شناسه کاربر"), { target: { value: "۵" } });
    fireEvent.change(screen.getByLabelText("شناسه اقامتگاه"), { target: { value: "10" } });
    fireEvent.change(screen.getByLabelText("عملیات"), { target: { value: "RoomCapacityChanged" } });
    fireEvent.change(screen.getByLabelText("از تاریخ (UTC)"), { target: { value: "2026-10-29" } });
    fireEvent.change(screen.getByLabelText("تا تاریخ (UTC)"), { target: { value: "2026-10-30" } });
    fireEvent.click(screen.getByRole("button", { name: "اعمال فیلتر" }));
    await waitFor(() => expect(mocks.request).toHaveBeenCalledTimes(2));
    const params = new URL(mocks.request.mock.calls[1][0], "http://localhost").searchParams;
    expect(params.get("actorUserId")).toBe("5"); expect(params.get("propertyId")).toBe("10");
    expect(params.get("action")).toBe("RoomCapacityChanged");
    expect(params.get("fromUtc")).toBe("2026-10-29T00:00:00Z");
    expect(params.get("toUtc")).toBe("2026-10-31T00:00:00.000Z");
  });

  it("paginates using server metadata and resets filters without fabricating totals", async () => {
    render(<Page />); await screen.findByText("مدیر آزمون");
    fireEvent.click(screen.getByRole("button", { name: "بعدی" }));
    await waitFor(() => expect(mocks.request).toHaveBeenCalledWith("/admin/audit-logs?page=2&pageSize=25", expect.anything()));
    await screen.findByText("مدیر آزمون");
    fireEvent.change(screen.getByRole("combobox", { name: "تعداد در صفحه" }), { target: { value: "50" } });
    await waitFor(() => expect(mocks.request).toHaveBeenCalledWith("/admin/audit-logs?page=1&pageSize=50", expect.anything()));
    expect(screen.getByRole("navigation", { name: "صفحه‌بندی تاریخچه" }).textContent).toContain("۲۶");
  });

  it("does not fetch without permission", () => {
    mocks.permissions = []; render(<Page />);
    expect(mocks.request).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toBeTruthy();
  });

  it("separates loading, empty, retry and forbidden states", async () => {
    let complete!: (value: AdminAuditPage) => void;
    mocks.request.mockReturnValueOnce(new Promise<AdminAuditPage>((resolve) => { complete = resolve; }));
    const view = render(<Page />);
    expect(screen.getByRole("status")).toBeTruthy();
    await act(async () => complete({ ...result(), items: [], totalCount: 0, totalPages: 0 }));
    expect(screen.getByText("رویدادی با این فیلترها ثبت نشده است.")).toBeTruthy();
    view.unmount();
    mocks.request.mockRejectedValueOnce(new Error("offline"));
    const failed = render(<Page />);
    expect(await screen.findByText("تاریخچه بارگذاری نشد")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "تلاش دوباره" }));
    expect(await screen.findByText("مدیر آزمون")).toBeTruthy();
    failed.unmount();
    mocks.request.mockRejectedValueOnce(new ApiRequestError("Forbidden", 403));
    render(<Page />);
    expect(await screen.findByText("دسترسی به تاریخچه ندارید")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "تلاش دوباره" })).toBeNull();
    expect(screen.queryByText("مدیر آزمون")).toBeNull();
  });

  it("ignores late responses and does not render unknown comparison fields", async () => {
    let old!: (value: AdminAuditPage) => void;
    mocks.request.mockReturnValueOnce(new Promise<AdminAuditPage>((resolve) => { old = resolve; }));
    render(<Page />);
    const current = result();
    current.items[0].actorDisplayName = "مدیر جدید";
    current.items[0].newValues = { TotalInventory: 3, Password: "never-render-this" };
    mocks.request.mockResolvedValue(current);
    fireEvent.change(screen.getByLabelText("شناسه کاربر"), { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: "اعمال فیلتر" }));
    expect(await screen.findByText("مدیر جدید")).toBeTruthy();
    await act(async () => old(result()));
    expect(screen.queryByText("مدیر آزمون")).toBeNull();
    expect(screen.queryByText("never-render-this")).toBeNull();
  });

  it("shows legacy rows without invented comparison data and validates reversed dates locally", async () => {
    const data = result(); data.items[0].previousValues = null; data.items[0].newValues = null;
    mocks.request.mockResolvedValue(data); render(<Page />);
    expect(await screen.findByText("مقادیر قبل و بعد ثبت نشده‌اند.")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("از تاریخ (UTC)"), { target: { value: "2026-10-30" } });
    fireEvent.change(screen.getByLabelText("تا تاریخ (UTC)"), { target: { value: "2026-10-29" } });
    fireEvent.click(screen.getByRole("button", { name: "اعمال فیلتر" }));
    expect(screen.getByRole("alert").textContent).toContain("پایان");
    expect(mocks.request).toHaveBeenCalledTimes(1);
  });

  it("lazily loads exact price-event details, shows ten dates, and supports more/less", async () => {
    const data = result();
    Object.assign(data.items[0], { action: "PriceChanged", entityType: "RoomDailyPrice", entityName: "اتاق دبل",
      hasPriceDetails: true, previousValues: null, newValues: { ChangedCellCount: 12, GuestType: "Iranian" } });
    const dates = Array.from({ length: 12 }, (_, index) => ({ date: `2026-11-${String(index + 1).padStart(2, "0")}`,
      previousPrice: 100 + index, newPrice: 200 + index, guestType: "Iranian" }));
    mocks.request.mockImplementation((path: string) => Promise.resolve(path.includes("price-changes") ?
      path.includes("after=") ? { items: dates.slice(10), hasMore: false, nextAfter: null } :
        { items: dates.slice(0, 10), hasMore: true, nextAfter: "2026-11-10" } : data));
    render(<Page />);
    expect(await screen.findByText(/اتاق دبل/)).toBeTruthy();
    expect(mocks.request).toHaveBeenCalledTimes(1);
    const details = screen.getByText("مشاهده تغییرات قیمت").closest("details")!;
    details.open = true; fireEvent(details, new Event("toggle"));
    const table = await screen.findByRole("table", { name: "تغییرات قیمت روزانه" });
    expect(within(table).getAllByRole("row")).toHaveLength(11);
    expect(table.querySelectorAll("time")[0].dateTime).toBe("2026-11-01");
    expect(mocks.request).toHaveBeenCalledWith("/admin/audit-logs/1/price-changes?propertyId=10&pageSize=10", expect.anything());
    expect(screen.getByText(/۱۲ تاریخ تغییرکرده/)).toBeTruthy();
    expect(within(table).getByText("۱۰۰ تومان")).toBeTruthy();
    expect(within(table).getByText("۲۰۰ تومان")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "نمایش بیشتر" }));
    await waitFor(() => expect(within(table).getAllByRole("row")).toHaveLength(13));
    expect(mocks.request).toHaveBeenLastCalledWith("/admin/audit-logs/1/price-changes?propertyId=10&pageSize=10&after=2026-11-10", expect.anything());
    fireEvent.click(screen.getByRole("button", { name: "نمایش کمتر" }));
    expect(within(table).getAllByRole("row")).toHaveLength(11);
    fireEvent.click(screen.getByRole("button", { name: "نمایش بیشتر" }));
    expect(within(table).getAllByRole("row")).toHaveLength(13);
    expect(mocks.request).toHaveBeenCalledTimes(3);
    details.open = false; fireEvent(details, new Event("toggle"));
    details.open = true; fireEvent(details, new Event("toggle"));
    await waitFor(() => expect(within(screen.getByRole("table", { name: "تغییرات قیمت روزانه" })).getAllByRole("row")).toHaveLength(11));
  });

  it("keeps historical price summaries without fabricating or fetching daily details", async () => {
    const data = result();
    Object.assign(data.items[0], { action: "PriceChanged", entityType: "RoomDailyPrice", hasPriceDetails: false,
      previousValues: null, newValues: { ChangedCellCount: 3, From: "2026-11-01", To: "2026-11-09" } });
    mocks.request.mockResolvedValue(data); render(<Page />);
    expect(await screen.findByText("تعداد خانه تغییرکرده")).toBeTruthy();
    expect(screen.queryByRole("table", { name: "تغییرات قیمت روزانه" })).toBeNull();
    expect(mocks.request).toHaveBeenCalledTimes(1);
  });

  it("handles price-detail failure with retry without breaking the audit list", async () => {
    const data = result();
    Object.assign(data.items[0], { action: "PriceChanged", entityType: "RoomDailyPrice", hasPriceDetails: true });
    let failed = false;
    mocks.request.mockImplementation((path: string) => {
      if (!path.includes("price-changes")) return Promise.resolve(data);
      if (!failed) { failed = true; return Promise.reject(new Error("offline")); }
      return Promise.resolve({ items: [{ date: "2026-11-03", previousPrice: 50, newPrice: 100, guestType: "Iranian" }], hasMore: false, nextAfter: null });
    });
    render(<Page />);
    const details = (await screen.findByText("مشاهده تغییرات قیمت")).closest("details")!;
    details.open = true; fireEvent(details, new Event("toggle"));
    expect(await screen.findByText("جزئیات قیمت بارگذاری نشد")).toBeTruthy();
    expect(screen.getByText("مدیر آزمون")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "تلاش دوباره" }));
    expect(await screen.findByRole("table", { name: "تغییرات قیمت روزانه" })).toBeTruthy();
  });
});
