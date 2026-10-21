import type { ReactNode } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  propertyId: "17",
  canViewBookings: true,
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
    effectivePermissions: { Bookings: { view: mocks.canViewBookings } },
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

const summary = {
  businessDate: "2026-10-21",
  pendingApprovalCount: 2,
  scheduledArrivalsTodayCount: 0,
  scheduledDeparturesTodayCount: 5,
};

function setupRequests() {
  mocks.apiRequest.mockImplementation((path: string) => {
    if (path.endsWith("/reservations/operational-summary")) return Promise.resolve(summary);
    if (path.endsWith("/completion")) return Promise.resolve({ completionPercentage: 80 });
    if (path.endsWith("/room-types")) return Promise.resolve([]);
    return Promise.resolve({ id: Number(mocks.propertyId), name: "خانه سرو", slug: "cedar", status: "Approved", city: "کاشان" });
  });
}

describe("Owner Property operational dashboard summary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.propertyId = "17";
    mocks.canViewBookings = true;
    setupRequests();
  });

  it("shows API counts, a real zero, scheduled labels and the API business date alongside setup widgets", async () => {
    render(<OwnerPropertyDashboardPage />);
    const section = await screen.findByRole("region", { name: "وضعیت رزروهای اقامتگاه" });
    expect(mocks.apiRequest).toHaveBeenCalledWith(
      "/owner/properties/17/reservations/operational-summary",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(within(section).getByText("۲")).toBeTruthy();
    expect(within(section).getByText("۰")).toBeTruthy();
    expect(within(section).getByText("۵")).toBeTruthy();
    expect(within(section).getByText("ورود برنامه‌ریزی‌شده امروز")).toBeTruthy();
    expect(within(section).getByText("خروج برنامه‌ریزی‌شده امروز")).toBeTruthy();
    expect(within(section).getByText(/بر پایه تاریخ امروز اقامتگاه/)).toBeTruthy();
    expect(within(section).getByText(/۱۴۰۵/)).toBeTruthy();
    expect(screen.getByText("وضعیت تکمیل اقامتگاه")).toBeTruthy();
    expect(screen.getByText("کارهای سریع")).toBeTruthy();
  });

  it("shows loading without fabricated zero counts", async () => {
    mocks.apiRequest.mockImplementation((path: string) =>
      path.endsWith("/reservations/operational-summary")
        ? new Promise(() => undefined)
        : path.endsWith("/completion") ? Promise.resolve({ completionPercentage: 80 })
        : path.endsWith("/room-types") ? Promise.resolve([])
        : Promise.resolve({ id: 17, name: "خانه سرو" }),
    );
    render(<OwnerPropertyDashboardPage />);
    const section = screen.getByRole("region", { name: "وضعیت رزروهای اقامتگاه" });
    expect(within(section).getByRole("status").textContent).toContain("در حال دریافت");
    expect(within(section).queryByText("۰")).toBeNull();
  });

  it("hides the section and makes no request without bookings.view", async () => {
    mocks.canViewBookings = false;
    render(<OwnerPropertyDashboardPage />);
    await waitFor(() => expect(screen.getByText("وضعیت تکمیل اقامتگاه")).toBeTruthy());
    expect(screen.queryByRole("region", { name: "وضعیت رزروهای اقامتگاه" })).toBeNull();
    expect(mocks.apiRequest.mock.calls.some(([path]) => String(path).includes("operational-summary"))).toBe(false);
  });

  it("isolates a summary error and retries without affecting setup widgets", async () => {
    mocks.apiRequest.mockImplementation((path: string) =>
      path.endsWith("/reservations/operational-summary")
        ? Promise.reject(new Error("offline"))
        : path.endsWith("/completion") ? Promise.resolve({ completionPercentage: 80 })
        : path.endsWith("/room-types") ? Promise.resolve([])
        : Promise.resolve({ id: 17, name: "خانه سرو" }),
    );
    render(<OwnerPropertyDashboardPage />);
    const section = await screen.findByRole("region", { name: "وضعیت رزروهای اقامتگاه" });
    expect(await within(section).findByRole("alert")).toBeTruthy();
    expect(screen.getByText("وضعیت تکمیل اقامتگاه")).toBeTruthy();
    setupRequests();
    fireEvent.click(within(section).getByRole("button", { name: "تلاش دوباره" }));
    expect(await within(section).findByText("۵")).toBeTruthy();
  });

  it("shows a distinct 403 state without retry or fabricated counts", async () => {
    mocks.apiRequest.mockImplementation((path: string) =>
      path.endsWith("/reservations/operational-summary")
        ? Promise.reject(new ApiRequestError("Forbidden", 403))
        : path.endsWith("/completion") ? Promise.resolve({ completionPercentage: 80 })
        : path.endsWith("/room-types") ? Promise.resolve([])
        : Promise.resolve({ id: 17, name: "خانه سرو" }),
    );
    render(<OwnerPropertyDashboardPage />);
    const section = await screen.findByRole("region", { name: "وضعیت رزروهای اقامتگاه" });
    expect(await within(section).findByText("دسترسی به خلاصه رزروها ندارید")).toBeTruthy();
    expect(within(section).queryByRole("button", { name: "تلاش دوباره" })).toBeNull();
    expect(screen.getByText("وضعیت تکمیل اقامتگاه")).toBeTruthy();
  });

  it("discards an old Property response after switching PropertyId", async () => {
    let resolveOld!: (value: typeof summary) => void;
    mocks.apiRequest.mockImplementation((path: string) => {
      if (path.includes("/properties/17/reservations/operational-summary")) {
        return new Promise((resolve) => { resolveOld = resolve; });
      }
      if (path.endsWith("/reservations/operational-summary")) {
        return Promise.resolve({ ...summary, pendingApprovalCount: 9 });
      }
      if (path.endsWith("/completion")) return Promise.resolve({ completionPercentage: 80 });
      if (path.endsWith("/room-types")) return Promise.resolve([]);
      return Promise.resolve({ id: Number(mocks.propertyId), name: "خانه سرو" });
    });
    const view = render(<OwnerPropertyDashboardPage />);
    await waitFor(() => expect(resolveOld).toBeTypeOf("function"));
    mocks.propertyId = "22";
    view.rerender(<OwnerPropertyDashboardPage />);
    const section = screen.getByRole("region", { name: "وضعیت رزروهای اقامتگاه" });
    expect(await within(section).findByText("۹")).toBeTruthy();
    resolveOld({ ...summary, pendingApprovalCount: 77 });
    await waitFor(() => expect(within(section).queryByText("۷۷")).toBeNull());
    expect(within(section).getByText("۹")).toBeTruthy();
  });
});
