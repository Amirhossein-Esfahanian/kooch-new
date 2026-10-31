import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminAuditPage } from "@/lib/admin-audit-logs";

const mocks = vi.hoisted(() => ({ request: vi.fn(), lookup: vi.fn(), guard: vi.fn(), permissions: ["ViewReports"] as string[] }));
vi.mock("@/components/auth/AuthSessionProvider", () => ({ useAuthSession: () => ({ authenticated: true,
  loading: false, workspaces: ["admin"], platformRole: "AdminAssistant", platformPermissions: mocks.permissions, user: { userId: 1 } }) }));
vi.mock("@/lib/owner-api", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/owner-api")>(),
  apiRequest: (path: string, options?: unknown) => path.includes("filter-options/")
    ? mocks.lookup(path, options) : mocks.request(path, options),
}));
vi.mock("@/components/dashboard/DashboardLayouts", () => ({
  AdminLayout: ({ children, requiredPlatformPermission }: { children: ReactNode; requiredPlatformPermission: string }) => {
    mocks.guard(requiredPlatformPermission); return children;
  },
}));
vi.mock("@/components/KoochDatePicker", () => ({ KoochDatePicker: ({ label, value, onChange, autoConfirmOnSelect }: {
  label: string; value: string | null; onChange: (value: string | null) => void; autoConfirmOnSelect?: boolean;
}) => <input aria-label={label} data-auto-confirm={autoConfirmOnSelect ? "true" : "false"} value={value ?? ""} onChange={(event) => onChange(event.target.value || null)} /> }));

import Page from "@/app/admin/activity-history/page";
import { ApiRequestError } from "@/lib/owner-api";
import { adminAuditPath, emptyAuditFilters } from "@/lib/admin-audit-logs";

function result(): AdminAuditPage {
  return { items: [{ id: 1, userId: 5, actorDisplayName: "مدیر آزمون", action: "RoomCapacityChanged",
    occurredAtUtc: "2026-10-30T08:00:00Z", entityType: "RoomType", entityId: 20,
    propertyId: 10, propertyName: "اقامتگاه سرو", description: "Room capacity changed.",
    previousValues: { TotalInventory: 2 }, newValues: { TotalInventory: 3 } }],
    page: 1, pageSize: 25, totalCount: 26, totalPages: 2 };
}

describe("Admin activity history", () => {
  beforeEach(() => {
    vi.clearAllMocks(); mocks.permissions = ["ViewReports"]; mocks.request.mockResolvedValue(result());
    mocks.lookup.mockImplementation((path: string) => Promise.resolve(path.includes("/actors")
      ? [{ id: 5, displayName: "مدیر آزمون" }, { id: 6, displayName: "مالک آزمون" }]
      : [{ id: 10, displayName: "اقامتگاه سرو" }, { id: 11, displayName: "اقامتگاه دوم" }]));
  });

  async function selectFilter(label: string, option: string) {
    fireEvent.click(screen.getByRole("button", { name: label }));
    fireEvent.click(await screen.findByRole("button", { name: option }));
  }

  it("uses Admin API and ViewReports, showing actor, target and allowed before/after values", async () => {
    render(<Page />);
    expect(await within(screen.getByRole("table")).findByText("مدیر آزمون")).toBeTruthy();
    expect(mocks.guard).toHaveBeenCalledWith("ViewReports");
    expect(mocks.request).toHaveBeenCalledWith("/admin/audit-logs?page=1&pageSize=25", expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(screen.getByText("اقامتگاه سرو")).toBeTruthy();
    expect(within(screen.getByRole("table")).getByText("تغییر ظرفیت اتاق")).toBeTruthy();
    fireEvent.click(await screen.findByRole("button", { name: "مشاهده تغییرات" }));
    expect(screen.getByText("موجودی کل")).toBeTruthy();
    expect(screen.getByText("قبل:").parentElement?.textContent).toContain("۲");
    expect(screen.getByText("بعد:").parentElement?.textContent).toContain("۳");
    expect(document.querySelector("time")?.getAttribute("datetime")).toBe("2026-10-30T08:00:00Z");
    expect(mocks.request.mock.calls.some(([path]) => path.startsWith("/owner/"))).toBe(false);
  });

  it("confirms picker selections immediately but fetches only after Apply Filters", async () => {
    render(<Page />); await screen.findByText("مدیر آزمون");
    const from = screen.getByLabelText("از تاریخ");
    const to = screen.getByLabelText("تا تاریخ");
    expect(from.getAttribute("data-auto-confirm")).toBe("true");
    expect(to.getAttribute("data-auto-confirm")).toBe("true");
    fireEvent.change(from, { target: { value: "2026-10-30" } });
    fireEvent.change(to, { target: { value: "2026-10-30" } });
    expect(mocks.request).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "اعمال فیلتر" }));
    await waitFor(() => expect(mocks.request).toHaveBeenCalledTimes(2));
  });

  it("applies actor, Property, action and inclusive Tehran date filters", async () => {
    render(<Page />); await screen.findByText("مدیر آزمون");
    await selectFilter("کاربر", "مدیر آزمون");
    await selectFilter("اقامتگاه", "اقامتگاه سرو");
    fireEvent.change(screen.getByLabelText("عملیات"), { target: { value: "RoomCapacityChanged" } });
    fireEvent.change(screen.getByLabelText("از تاریخ"), { target: { value: "2026-10-29" } });
    fireEvent.change(screen.getByLabelText("تا تاریخ"), { target: { value: "2026-10-30" } });
    fireEvent.click(screen.getByRole("button", { name: "اعمال فیلتر" }));
    await waitFor(() => expect(mocks.request).toHaveBeenCalledTimes(2));
    const params = new URL(mocks.request.mock.calls[1][0], "http://localhost").searchParams;
    expect(params.get("actorUserId")).toBe("5"); expect(params.get("propertyId")).toBe("10");
    expect(params.get("action")).toBe("RoomCapacityChanged");
    expect(params.get("fromUtc")).toBe("2026-10-28T20:30:00.000Z");
    expect(params.get("toUtc")).toBe("2026-10-30T20:30:00.000Z");
  });

  it("searches safe lookup options, sends selected IDs only after Apply, and clears selections", async () => {
    render(<Page />); await screen.findByText("مدیر آزمون");
    await waitFor(() => expect(mocks.lookup).toHaveBeenCalledTimes(2));
    expect(mocks.lookup.mock.calls.map(([path]) => path)).toEqual(expect.arrayContaining([
      "/admin/audit-logs/filter-options/actors?limit=20",
      "/admin/audit-logs/filter-options/properties?limit=20",
    ]));
    fireEvent.click(screen.getByRole("button", { name: "کاربر" }));
    fireEvent.change(screen.getByPlaceholderText("جست‌وجوی کاربر"), { target: { value: "مالک" } });
    await waitFor(() => expect(mocks.lookup.mock.calls.some(([path]) => path.includes("/actors?") && path.includes("search=%D9%85"))).toBe(true));
    fireEvent.click(screen.getByRole("button", { name: "مالک آزمون" }));
    await selectFilter("اقامتگاه", "اقامتگاه سرو");
    expect(mocks.request).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "اعمال فیلتر" }));
    await waitFor(() => expect(mocks.request).toHaveBeenCalledTimes(2));
    const selected = new URL(mocks.request.mock.calls[1][0], "http://localhost").searchParams;
    expect(selected.get("actorUserId")).toBe("6");
    expect(selected.get("propertyId")).toBe("10");
    fireEvent.keyDown(screen.getByRole("button", { name: "کاربر" }), { key: "Backspace" });
    fireEvent.keyDown(screen.getByRole("button", { name: "اقامتگاه" }), { key: "Backspace" });
    expect(mocks.request).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole("button", { name: "اعمال فیلتر" }));
    await waitFor(() => expect(mocks.request).toHaveBeenCalledTimes(3));
    expect(mocks.request).toHaveBeenLastCalledWith("/admin/audit-logs?page=1&pageSize=25", expect.anything());
  });

  it("renders multiple independent expanded rows directly beneath their parents", async () => {
    const data = result();
    data.items.push({ ...data.items[0], id: 2, actorDisplayName: "مالک آزمون",
      previousValues: { TotalInventory: 4 }, newValues: { TotalInventory: 5 } });
    mocks.request.mockResolvedValue(data);
    render(<Page />);
    const buttons = await screen.findAllByRole("button", { name: "مشاهده تغییرات" });
    buttons.forEach((button) => fireEvent.click(button));
    const table = screen.getByRole("table");
    expect(table.querySelectorAll("tbody > tr > td[colspan='5']")).toHaveLength(2);
    buttons.forEach((button) => {
      const parent = button.closest("tr")!;
      expect(parent.nextElementSibling?.querySelector("td")?.getAttribute("colspan")).toBe("5");
      expect(button.getAttribute("aria-expanded")).toBe("true");
    });
    fireEvent.click(screen.getAllByRole("button", { name: "بستن تغییرات" })[0]);
    expect(table.querySelectorAll("tbody > tr > td[colspan='5']")).toHaveLength(1);
  });

  it("uses Tehran day boundaries independent of device timezone, including historical offset changes", () => {
    for (const deviceTimeZone of ["UTC", "America/Los_Angeles"]) {
      vi.stubEnv("TZ", deviceTimeZone);
      const path = adminAuditPath({ ...emptyAuditFilters, from: "2026-10-30", to: "2026-10-30" }, 1, 25);
      const params = new URL(path, "http://localhost").searchParams;
      const from = params.get("fromUtc")!;
      const to = params.get("toUtc")!;
      expect(from).toBe("2026-10-29T20:30:00.000Z");
      expect(to).toBe("2026-10-30T20:30:00.000Z");
      expect(Date.parse("2026-10-29T20:29:59.999Z") >= Date.parse(from)).toBe(false);
      expect(Date.parse("2026-10-29T20:30:00.000Z") >= Date.parse(from)).toBe(true);
      expect(Date.parse("2026-10-30T20:29:59.999Z") < Date.parse(to)).toBe(true);
      expect(Date.parse("2026-10-30T20:30:00.000Z") < Date.parse(to)).toBe(false);
    }
    vi.unstubAllEnvs();
    const historical = new URL(adminAuditPath({ ...emptyAuditFilters, from: "2021-07-01" }, 1, 25), "http://localhost");
    expect(historical.searchParams.get("fromUtc")).toBe("2021-06-30T19:30:00.000Z");
  });

  it("clears both draft dates and applied date parameters", async () => {
    render(<Page />); await screen.findByText("مدیر آزمون");
    fireEvent.change(screen.getByLabelText("از تاریخ"), { target: { value: "2026-10-30" } });
    fireEvent.change(screen.getByLabelText("تا تاریخ"), { target: { value: "2026-10-30" } });
    fireEvent.click(screen.getByRole("button", { name: "اعمال فیلتر" }));
    await waitFor(() => expect(mocks.request).toHaveBeenCalledTimes(2));
    fireEvent.click(screen.getByRole("button", { name: "پاک کردن فیلترها" }));
    await waitFor(() => expect(mocks.request).toHaveBeenCalledTimes(3));
    expect(screen.getByLabelText("از تاریخ").getAttribute("value")).toBe("");
    expect(screen.getByLabelText("تا تاریخ").getAttribute("value")).toBe("");
    expect(mocks.request).toHaveBeenLastCalledWith("/admin/audit-logs?page=1&pageSize=25", expect.anything());
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
    expect(mocks.lookup).not.toHaveBeenCalled();
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
    expect(await within(screen.getByRole("table")).findByText("مدیر آزمون")).toBeTruthy();
    failed.unmount();
    mocks.request.mockRejectedValueOnce(new ApiRequestError("Forbidden", 403));
    render(<Page />);
    expect(await screen.findByText("دسترسی به تاریخچه ندارید")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "تلاش دوباره" })).toBeNull();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("ignores late responses and does not render unknown comparison fields", async () => {
    let old!: (value: AdminAuditPage) => void;
    mocks.request.mockReturnValueOnce(new Promise<AdminAuditPage>((resolve) => { old = resolve; }));
    render(<Page />);
    const current = result();
    current.items[0].actorDisplayName = "مدیر جدید";
    current.items[0].newValues = { TotalInventory: 3, Password: "never-render-this" };
    mocks.request.mockResolvedValue(current);
    await selectFilter("کاربر", "مدیر آزمون");
    fireEvent.click(screen.getByRole("button", { name: "اعمال فیلتر" }));
    expect(await screen.findByText("مدیر جدید")).toBeTruthy();
    await act(async () => old(result()));
    expect(within(screen.getByRole("table")).queryByText("مدیر آزمون")).toBeNull();
    expect(screen.queryByText("never-render-this")).toBeNull();
  });

  it("shows legacy rows without invented comparison data and validates reversed dates locally", async () => {
    const data = result(); data.items[0].previousValues = null; data.items[0].newValues = null;
    mocks.request.mockResolvedValue(data); render(<Page />);
    expect(await screen.findByText("مقادیر قبل و بعد ثبت نشده‌اند.")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("از تاریخ"), { target: { value: "2026-10-30" } });
    fireEvent.change(screen.getByLabelText("تا تاریخ"), { target: { value: "2026-10-29" } });
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
    fireEvent.click(screen.getByRole("button", { name: "مشاهده تغییرات قیمت" }));
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
    fireEvent.click(screen.getByRole("button", { name: "بستن تغییرات" }));
    fireEvent.click(screen.getByRole("button", { name: "مشاهده تغییرات قیمت" }));
    await waitFor(() => expect(within(screen.getByRole("table", { name: "تغییرات قیمت روزانه" })).getAllByRole("row")).toHaveLength(11));
  });

  it("keeps historical price summaries without fabricating or fetching daily details", async () => {
    const data = result();
    Object.assign(data.items[0], { action: "PriceChanged", entityType: "RoomDailyPrice", hasPriceDetails: false,
      previousValues: null, newValues: { ChangedCellCount: 3, From: "2026-11-01", To: "2026-11-09" } });
    mocks.request.mockResolvedValue(data); render(<Page />);
    fireEvent.click(await screen.findByRole("button", { name: "مشاهده تغییرات" }));
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
    fireEvent.click(await screen.findByRole("button", { name: "مشاهده تغییرات قیمت" }));
    expect(await screen.findByText("جزئیات قیمت بارگذاری نشد")).toBeTruthy();
    expect(screen.getByText("مدیر آزمون")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "تلاش دوباره" }));
    expect(await screen.findByRole("table", { name: "تغییرات قیمت روزانه" })).toBeTruthy();
  });
});
