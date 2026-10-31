import type { ReactNode } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  propertyId: "17",
  canViewReports: true,
  apiRequest: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: mocks.propertyId }),
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock("@/components/auth/AuthSessionProvider", () => ({
  useAuthSession: () => ({ authenticated: true, loading: false, workspaces: ["owner"] }),
}));
vi.mock("@/components/dashboard/DashboardLayouts", () => ({
  OwnerLayout: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock("@/components/owner/OwnerPropertyProvider", () => ({
  useOwnerProperty: () => ({
    routePropertyIsValid: true,
    effectivePermissions: { Reports: { view: mocks.canViewReports }, Bookings: { view: false } },
  }),
}));
vi.mock("@/components/property/PropertyCompletionCard", () => ({
  PropertyCompletionCard: () => <div>وضعیت تکمیل اقامتگاه</div>,
}));
vi.mock("@/lib/owner-api", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/owner-api")>(),
  apiRequest: (...args: unknown[]) => mocks.apiRequest(...args),
}));

import OwnerPropertyDashboardPage from "@/app/owner/properties/[id]/dashboard/page";
import { ApiRequestError } from "@/lib/owner-api";

const dates = Array.from({ length: 90 }, (_, index) =>
  new Date(Date.UTC(2026, 9, 21 - 89 + index)).toISOString().slice(0, 10));
const dailyVisits = dates.map((businessDate) => ({
  businessDate,
  recordedVisits: ({
    "2026-07-24": 13,
    "2026-09-21": 11,
    "2026-09-22": 7,
    "2026-10-14": 5,
    "2026-10-15": 2,
    "2026-10-21": 3,
  } as Record<string, number>)[businessDate] ?? 0,
}));
const analytics = {
  businessDate: "2026-10-21",
  todayRecordedVisits: 3,
  last7DaysTotal: 5,
  last30DaysTotal: 17,
  last90DaysTotal: 41,
  dailyVisits,
};

function setupRequests(visitResponse: unknown = analytics) {
  mocks.apiRequest.mockImplementation((path: string) => {
    if (path.endsWith("/visits/analytics")) return Promise.resolve(visitResponse);
    if (path.endsWith("/completion")) return Promise.resolve({ completionPercentage: 80 });
    if (path.endsWith("/room-types")) return Promise.resolve([]);
    return Promise.resolve({ id: Number(mocks.propertyId), name: "خانه سرو", slug: "cedar", status: "Approved", city: "کاشان" });
  });
}

describe("Owner Property Visit Analytics", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.propertyId = "17";
    mocks.canViewReports = true;
    setupRequests();
  });

  it("renders the backend's Tehran date, today count, default 30-day total and daily points", async () => {
    render(<OwnerPropertyDashboardPage />);
    const section = await screen.findByRole("region", { name: "بازدیدهای ثبت‌شده" });
    expect(mocks.apiRequest).toHaveBeenCalledWith(
      "/owner/properties/17/visits/analytics",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(await within(section).findByText("۱۷")).toBeTruthy();
    expect(within(within(section).getByRole("region", { name: "بازدیدهای ثبت‌شده امروز" })).getByText("۳")).toBeTruthy();
    expect(within(section).getByText(/امروز بر پایه تاریخ تهران/)).toBeTruthy();
    expect(section.querySelector("time")?.getAttribute("datetime")).toBe("2026-10-21");
    expect(section.querySelector("time")?.textContent).toContain("۱۴۰۵");
    expect(within(section).getByRole("button", { name: "۳۰ روز گذشته" }).getAttribute("aria-pressed")).toBe("true");
    expect(section.querySelectorAll("table tbody tr")).toHaveLength(30);
    expect(section.querySelector("table tbody tr:last-child th")?.textContent).toBe(section.querySelector("time")?.textContent);
    expect(within(section).getByText(/تاریخ شروع ثبت بازدیدها مشخص نیست/)).toBeTruthy();
  });

  it("uses authoritative 7/30/90 totals while slicing the daily chart without refetching", async () => {
    render(<OwnerPropertyDashboardPage />);
    const section = await screen.findByRole("region", { name: "بازدیدهای ثبت‌شده" });
    expect(await within(section).findByText("۱۷")).toBeTruthy();
    fireEvent.click(within(section).getByRole("button", { name: "۷ روز گذشته" }));
    expect(within(within(section).getByRole("region", { name: "بازدیدهای ثبت‌شده در بازه انتخاب‌شده" })).getByText("۵")).toBeTruthy();
    expect(section.querySelectorAll("table tbody tr")).toHaveLength(7);
    fireEvent.click(within(section).getByRole("button", { name: "۹۰ روز گذشته" }));
    expect(within(within(section).getByRole("region", { name: "بازدیدهای ثبت‌شده در بازه انتخاب‌شده" })).getByText("۴۱")).toBeTruthy();
    expect(section.querySelectorAll("table tbody tr")).toHaveLength(90);
    expect(mocks.apiRequest.mock.calls.filter(([path]) => String(path).endsWith("/visits/analytics"))).toHaveLength(1);
  });

  it("shows a skeleton while loading and an honest zero-data state", async () => {
    mocks.apiRequest.mockImplementation((path: string) =>
      path.endsWith("/visits/analytics") ? new Promise(() => undefined) :
      path.endsWith("/completion") ? Promise.resolve({ completionPercentage: 80 }) :
      path.endsWith("/room-types") ? Promise.resolve([]) :
      Promise.resolve({ id: 17, name: "خانه سرو" }));
    const view = render(<OwnerPropertyDashboardPage />);
    const section = screen.getByRole("region", { name: "بازدیدهای ثبت‌شده" });
    expect(within(section).getByRole("status", { name: "در حال دریافت آمار بازدیدها" })).toBeTruthy();
    expect(within(section).queryByText("۰")).toBeNull();

    view.unmount();
    setupRequests({ ...analytics, todayRecordedVisits: 0, last7DaysTotal: 0, last30DaysTotal: 0,
      last90DaysTotal: 0, dailyVisits: dailyVisits.map((point) => ({ ...point, recordedVisits: 0 })) });
    render(<OwnerPropertyDashboardPage />);
    const empty = await screen.findByRole("region", { name: "بازدیدهای ثبت‌شده" });
    expect(await within(empty).findByText("در این بازه بازدیدی ثبت نشده است.")).toBeTruthy();
    expect(within(within(empty).getByRole("region", { name: "بازدیدهای ثبت‌شده امروز" })).getByText("۰")).toBeTruthy();
    expect(within(within(empty).getByRole("region", { name: "بازدیدهای ثبت‌شده در بازه انتخاب‌شده" })).getByText("۰")).toBeTruthy();
  });

  it("shows a clean empty chart when no daily points are returned", async () => {
    setupRequests({ ...analytics, todayRecordedVisits: 0, last7DaysTotal: 0,
      last30DaysTotal: 0, last90DaysTotal: 0, dailyVisits: [] });
    render(<OwnerPropertyDashboardPage />);
    const section = await screen.findByRole("region", { name: "بازدیدهای ثبت‌شده" });
    expect(await within(section).findByText("داده‌ای برای نمایش نمودار وجود ندارد.")).toBeTruthy();
    expect(within(section).queryByRole("img")).toBeNull();
    expect(within(within(section).getByRole("region", { name: "بازدیدهای ثبت‌شده امروز" })).getByText("۰")).toBeTruthy();
  });

  it("never requests analytics without reports.view", async () => {
    mocks.canViewReports = false;
    render(<OwnerPropertyDashboardPage />);
    await waitFor(() => expect(screen.getByText("وضعیت تکمیل اقامتگاه")).toBeTruthy());
    expect(screen.queryByRole("region", { name: "بازدیدهای ثبت‌شده" })).toBeNull();
    expect(mocks.apiRequest.mock.calls.some(([path]) => String(path).endsWith("/visits/analytics"))).toBe(false);
  });

  it.each([403, 404])("hides visit values on an unauthorized or missing Property response (%s)", async (status) => {
    mocks.apiRequest.mockImplementation((path: string) =>
      path.endsWith("/visits/analytics") ? Promise.reject(new ApiRequestError("Unavailable", status)) :
      path.endsWith("/completion") ? Promise.resolve({ completionPercentage: 80 }) :
      path.endsWith("/room-types") ? Promise.resolve([]) :
      Promise.resolve({ id: 17, name: "خانه سرو" }));
    render(<OwnerPropertyDashboardPage />);
    const section = await screen.findByRole("region", { name: "بازدیدهای ثبت‌شده" });
    expect(await within(section).findByText("دسترسی به آمار بازدیدهای این اقامتگاه ندارید")).toBeTruthy();
    expect(within(section).queryByRole("img")).toBeNull();
    expect(within(section).queryByRole("button", { name: "تلاش دوباره" })).toBeNull();
    expect(screen.getByText("وضعیت تکمیل اقامتگاه")).toBeTruthy();
  });

  it("keeps the dashboard working on analytics errors and retries", async () => {
    mocks.apiRequest.mockImplementation((path: string) =>
      path.endsWith("/visits/analytics") ? Promise.reject(new Error("offline")) :
      path.endsWith("/completion") ? Promise.resolve({ completionPercentage: 80 }) :
      path.endsWith("/room-types") ? Promise.resolve([]) :
      Promise.resolve({ id: 17, name: "خانه سرو" }));
    render(<OwnerPropertyDashboardPage />);
    const section = await screen.findByRole("region", { name: "بازدیدهای ثبت‌شده" });
    expect(await within(section).findByText("دریافت آمار بازدیدها انجام نشد")).toBeTruthy();
    expect(screen.getByText("وضعیت تکمیل اقامتگاه")).toBeTruthy();
    setupRequests();
    fireEvent.click(within(section).getByRole("button", { name: "تلاش دوباره" }));
    expect(await within(section).findByText("۱۷")).toBeTruthy();
  });

  it("discards an older Property response when PropertyId changes", async () => {
    let resolveOld!: (value: typeof analytics) => void;
    mocks.apiRequest.mockImplementation((path: string) => {
      if (path.includes("/properties/17/visits/analytics")) return new Promise((resolve) => { resolveOld = resolve; });
      if (path.endsWith("/visits/analytics")) return Promise.resolve({ ...analytics, todayRecordedVisits: 9 });
      if (path.endsWith("/completion")) return Promise.resolve({ completionPercentage: 80 });
      if (path.endsWith("/room-types")) return Promise.resolve([]);
      return Promise.resolve({ id: Number(mocks.propertyId), name: "خانه سرو" });
    });
    const view = render(<OwnerPropertyDashboardPage />);
    await waitFor(() => expect(resolveOld).toBeTypeOf("function"));
    mocks.propertyId = "22";
    view.rerender(<OwnerPropertyDashboardPage />);
    const section = screen.getByRole("region", { name: "بازدیدهای ثبت‌شده" });
    const todayCard = await within(section).findByRole("region", { name: "بازدیدهای ثبت‌شده امروز" });
    expect(within(todayCard).getByText("۹")).toBeTruthy();
    resolveOld(analytics);
    await waitFor(() => expect(within(todayCard).getByText("۹")).toBeTruthy());
    expect(within(todayCard).queryByText("۳")).toBeNull();
  });
});
