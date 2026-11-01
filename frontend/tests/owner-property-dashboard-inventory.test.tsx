import type { ReactNode } from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  propertyId: "17",
  canViewReports: true,
  routePropertyIsValid: true,
  apiRequest: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useParams: () => ({ id: mocks.propertyId }) }));
vi.mock("@/components/auth/AuthSessionProvider", () => ({
  useAuthSession: () => ({ authenticated: true, loading: false, workspaces: ["owner"] }),
}));
vi.mock("@/components/dashboard/DashboardLayouts", () => ({
  OwnerLayout: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock("@/components/owner/OwnerPropertyProvider", () => ({
  useOwnerProperty: () => ({
    routePropertyIsValid: mocks.routePropertyIsValid,
    effectivePermissions: {
      Reports: { view: mocks.canViewReports }, Bookings: { view: true },
      Rooms: { view: true }, Inventory: { view: true },
    },
  }),
}));
vi.mock("@/lib/owner-api", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/owner-api")>(),
  apiRequest: (...args: unknown[]) => mocks.apiRequest(...args),
}));

import OwnerPropertyDashboardPage from "@/app/owner/properties/[id]/dashboard/page";
import { ApiRequestError } from "@/lib/owner-api";

const summary = {
  propertyId: 17, businessDate: "2026-11-01", configuredUnits: 12,
  eligibleConfiguredUnits: 10, reservedAllocatedUnits: 2, remainingUnits: 8,
  availableModeRemainingUnits: 5, onRequestRemainingUnits: 3, blockedRoomTypeCount: 1,
};
const labels = ["ظرفیت تعریف‌شده", "تخصیص‌یافته به رزروها", "باقی‌مانده عادی", "باقی‌مانده درخواستی"];

function setup(inventory: (path: string, init?: RequestInit) => Promise<unknown> = () => Promise.resolve(summary)) {
  mocks.apiRequest.mockImplementation((path: string, init?: RequestInit) => {
    if (path.endsWith("/inventory/today-summary")) return inventory(path, init);
    if (path.endsWith("/visits/analytics")) return Promise.resolve({ businessDate: summary.businessDate, todayRecordedVisits: 0, last7DaysTotal: 0, last30DaysTotal: 0, last90DaysTotal: 0, dailyVisits: [] });
    if (path.includes("/reservations?")) return Promise.resolve({ totalCount: 0 });
    if (path.endsWith("/operational-summary")) return Promise.resolve({ businessDate: summary.businessDate, pendingApprovalCount: 1, scheduledArrivalsTodayCount: 2, scheduledDeparturesTodayCount: 3 });
    if (path.endsWith("/completion")) return Promise.resolve({ canActivate: true, sections: [] });
    if (path.endsWith("/room-types")) return Promise.resolve([{ id: 1, isActive: true }]);
    return Promise.resolve({ id: Number(mocks.propertyId), name: "خانه سرو", status: "Approved" });
  });
}

describe("Owner dashboard daily inventory", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.propertyId = "17";
    mocks.canViewReports = true;
    mocks.routePropertyIsValid = true;
    setup();
  });

  it("renders the exact API metrics in four responsive cards after quick actions and before analytics", async () => {
    render(<OwnerPropertyDashboardPage />);
    const section = screen.getByRole("region", { name: "وضعیت موجودی امروز" });
    await within(section).findByText("۱۲");
    ["۱۲", "۲", "۵", "۳"].forEach((value, index) => {
      const card = within(section).getByRole("region", { name: labels[index] });
      expect(within(card).getByText(value)).toBeTruthy();
      expect(within(card).getByText("واحد رزرو")).toBeTruthy();
    });
    expect(mocks.apiRequest).toHaveBeenCalledWith("/owner/properties/17/inventory/today-summary", expect.objectContaining({ signal: expect.any(AbortSignal) }));
    const cards = within(section).getByRole("region", { name: labels[0] }).parentElement;
    expect(cards?.children).toHaveLength(4);
    expect(cards?.className).toContain("sm:grid-cols-2");
    expect(cards?.className).toContain("lg:grid-cols-4");
    expect(section.getAttribute("dir")).toBe("rtl");
    expect(screen.getByRole("region", { name: "کارهای سریع" }).compareDocumentPosition(section) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(section.compareDocumentPosition(screen.getByRole("region", { name: "بازدیدهای ثبت‌شده" })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(section.querySelector("time")?.getAttribute("datetime")).toBe("2026-11-01");
    expect(section.querySelector("time")?.textContent).toContain("۱۴۰۵");
    expect(within(section).getByText(/تضمین فروش یا رزرو فوری نیست/)).toBeTruthy();
  });

  it("shows genuine zero values and a precise empty state", async () => {
    setup(() => Promise.resolve({ ...summary, configuredUnits: 0, reservedAllocatedUnits: 0, availableModeRemainingUnits: 0, onRequestRemainingUnits: 0 }));
    render(<OwnerPropertyDashboardPage />);
    const section = screen.getByRole("region", { name: "وضعیت موجودی امروز" });
    expect(await within(section).findByText("برای امروز ظرفیت یا تخصیص رزروی ثبت نشده است.")).toBeTruthy();
    expect(within(section).getAllByText("۰")).toHaveLength(4);
  });

  it("shows a loading skeleton without unknown zero values or disabling other sections", async () => {
    setup(() => new Promise(() => undefined));
    render(<OwnerPropertyDashboardPage />);
    const section = screen.getByRole("region", { name: "وضعیت موجودی امروز" });
    expect(within(section).getByRole("status", { name: "در حال دریافت موجودی امروز" })).toBeTruthy();
    expect(within(section).queryByText("۰")).toBeNull();
    expect(await screen.findByRole("heading", { name: "خانه سرو" })).toBeTruthy();
    expect(await within(screen.getByRole("region", { name: "وضعیت رزروهای اقامتگاه" })).findByText("خروج‌های امروز")).toBeTruthy();
  });

  it.each([false, true])("does not request or display data without permission or valid Property access (%s)", async (invalidRoute) => {
    mocks.canViewReports = invalidRoute;
    mocks.routePropertyIsValid = !invalidRoute;
    render(<OwnerPropertyDashboardPage />);
    await act(async () => undefined);
    expect(screen.queryByRole("region", { name: "وضعیت موجودی امروز" })).toBeNull();
    expect(mocks.apiRequest.mock.calls.some(([path]) => path.endsWith("/inventory/today-summary"))).toBe(false);
  });

  it("isolates errors and retries only inventory without refreshing other dashboard requests", async () => {
    setup(() => Promise.reject(new Error("offline")));
    render(<OwnerPropertyDashboardPage />);
    const section = screen.getByRole("region", { name: "وضعیت موجودی امروز" });
    expect(await within(section).findByText("دریافت موجودی امروز انجام نشد")).toBeTruthy();
    expect(within(section).queryByText("۰")).toBeNull();
    expect(screen.getByRole("heading", { name: "خانه سرو" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "۳۰ روز گذشته" })).toBeTruthy();
    setup();
    fireEvent.click(within(section).getByRole("button", { name: "تلاش دوباره" }));
    expect(await within(section).findByText("۱۲")).toBeTruthy();
    expect(mocks.apiRequest.mock.calls.filter(([path]) => path.endsWith("/inventory/today-summary"))).toHaveLength(2);
    expect(mocks.apiRequest.mock.calls.filter(([path]) => path.endsWith("/visits/analytics"))).toHaveLength(1);
  });

  it.each([403, 404])("handles %s without displaying counts or a retry", async (status) => {
    setup(() => Promise.reject(new ApiRequestError("Denied", status)));
    render(<OwnerPropertyDashboardPage />);
    const section = screen.getByRole("region", { name: "وضعیت موجودی امروز" });
    expect(await within(section).findByText("دسترسی به موجودی امروز این اقامتگاه ندارید")).toBeTruthy();
    expect(within(section).queryByRole("button")).toBeNull();
    expect(within(section).queryByText("۰")).toBeNull();
  });

  it.each([undefined, null, -1, "4", Number.NaN])("rejects missing or invalid API values (%s) instead of fabricating zero", async (value) => {
    setup(() => Promise.resolve({ ...summary, availableModeRemainingUnits: value }));
    render(<OwnerPropertyDashboardPage />);
    const section = screen.getByRole("region", { name: "وضعیت موجودی امروز" });
    expect(await within(section).findByText("دریافت موجودی امروز انجام نشد")).toBeTruthy();
    expect(within(section).queryByText("۰")).toBeNull();
    expect(within(section).queryByRole("region", { name: labels[0] })).toBeNull();
  });

  it("discards old responses after switching Properties, including a response that ignores abort", async () => {
    let resolveOld!: (value: typeof summary) => void;
    setup((path) => path.includes("/17/") ? new Promise((resolve) => { resolveOld = resolve; })
      : Promise.resolve({ ...summary, propertyId: 22, configuredUnits: 9 }));
    const view = render(<OwnerPropertyDashboardPage />);
    await waitFor(() => expect(resolveOld).toBeTypeOf("function"));
    mocks.propertyId = "22";
    view.rerender(<OwnerPropertyDashboardPage />);
    const section = screen.getByRole("region", { name: "وضعیت موجودی امروز" });
    expect(await within(section).findByText("۹")).toBeTruthy();
    await act(async () => resolveOld({ ...summary, configuredUnits: 77 }));
    expect(within(section).queryByText("۷۷")).toBeNull();
    expect(within(section).getByText("۹")).toBeTruthy();
    expect(mocks.apiRequest).toHaveBeenCalledWith("/owner/properties/22/inventory/today-summary", expect.anything());
  });

  it("removes the summary immediately when Reports permission is revoked", async () => {
    const view = render(<OwnerPropertyDashboardPage />);
    await within(screen.getByRole("region", { name: "وضعیت موجودی امروز" })).findByText("۱۲");
    mocks.canViewReports = false;
    view.rerender(<OwnerPropertyDashboardPage />);
    expect(screen.queryByRole("region", { name: "وضعیت موجودی امروز" })).toBeNull();
  });

  it("rejects a response for a different Property", async () => {
    setup(() => Promise.resolve({ ...summary, propertyId: 99 }));
    render(<OwnerPropertyDashboardPage />);
    const section = screen.getByRole("region", { name: "وضعیت موجودی امروز" });
    expect(await within(section).findByText("دریافت موجودی امروز انجام نشد")).toBeTruthy();
    expect(within(section).queryByText("۱۲")).toBeNull();
  });
});
