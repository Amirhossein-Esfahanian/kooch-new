import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

const mocks = vi.hoisted(() => ({
  request: vi.fn(), id: "37", query: "", router: { push: vi.fn(), replace: vi.fn() },
  session: { platformRole: "SuperAdmin", platformPermissions: [] as string[], propertyMemberships: [], authenticated: true, loading: false, workspaces: ["admin"] },
}));
vi.mock("next/navigation", () => ({ useParams: () => ({ reservationId: mocks.id }), useRouter: () => mocks.router, useSearchParams: () => new URLSearchParams(mocks.query) }));
vi.mock("@/components/auth/AuthSessionProvider", () => ({ useAuthSession: () => mocks.session }));
vi.mock("@/components/dashboard/DashboardLayouts", () => ({ AdminLayout: ({ children }: { children: ReactNode }) => <div data-testid="admin-shell">{children}</div> }));
vi.mock("@/components/reservations/ManualReservationDialog", () => ({ ManualReservationDialog: () => null }));
vi.mock("@/components/reservations/vouchers/AdminVoucherView", () => ({ AdminVoucherView: () => <p>ووچر آزمون</p> }));
vi.mock("@/lib/owner-api", async original => ({ ...(await original<typeof import("@/lib/owner-api")>()), apiRequest: mocks.request }));
vi.mock("@/lib/currency", async original => ({ ...(await original<typeof import("@/lib/currency")>()), useSiteCurrencyLabel: () => "ریال" }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));

import DetailsPage from "@/app/admin/reservations/[reservationId]/page";
import VoucherPage from "@/app/admin/reservations/[reservationId]/voucher/page";

const item = { id: 37, reservationNumber: "R-855759", source: "AdminCreated", propertyId: 3, propertyName: "اقامتگاه آزمون",
  status: "Confirmed", checkInDate: "2030-02-01", checkOutDate: "2030-02-03", guestName: "مهمان آزمون",
  allowedStatusTransitions: ["Cancelled"], currency: "IRR", finalAmount: 5_000_000, remainingAmount: 5_000_000 };

describe("dedicated Admin reservation details", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.id = "37"; mocks.query = "";
    mocks.session.authenticated = true; mocks.session.loading = false; mocks.session.workspaces = ["admin"];
    mocks.session.platformRole = "SuperAdmin"; mocks.session.platformPermissions = [];
    mocks.request.mockImplementation(async (path: string) => {
      if (path === "/admin/reservations/37") return item;
      if (path === "/admin/reservations/37/activities" || path === "/admin/manual-payments/reservation/37") return [];
      throw new Error(path);
    });
  });

  it("loads from its stable ID on direct entry and reload without loading the list", async () => {
    const page = render(<DetailsPage />);
    await screen.findByRole("heading", { level: 1, name: /R-/ });
    expect(screen.getByTestId("admin-shell")).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getAllByText("تایید شده", { exact: true })).toHaveLength(1);
    expect(screen.getByRole("link", { name: "بازگشت به رزروها" }).getAttribute("href")).toBe("/admin/reservations");
    expect(mocks.request.mock.calls.some(([path]) => String(path).includes("/admin/reservations?"))).toBe(false);
    page.unmount();
    render(<DetailsPage />);
    await screen.findByRole("heading", { level: 1, name: /R-/ });
    expect(mocks.request.mock.calls.filter(([path]) => path === "/admin/reservations/37")).toHaveLength(2);
  });

  it("preserves the list filters and page through a reloadable return link", async () => {
    mocks.query = new URLSearchParams({ returnTo: "/admin/reservations?propertyId=3&status=Confirmed&page=4" }).toString();
    render(<DetailsPage />);
    await screen.findByRole("heading", { level: 1 });
    expect(screen.getByRole("link", { name: "بازگشت به رزروها" }).getAttribute("href"))
      .toBe("/admin/reservations?propertyId=3&status=Confirmed&page=4");
    fireEvent.click(screen.getByRole("button", { name: "مشاهده ووچر" }));
    expect(mocks.router.push).toHaveBeenCalledWith("/admin/reservations/37/voucher?returnTo=%2Fadmin%2Freservations%3FpropertyId%3D3%26status%3DConfirmed%26page%3D4");
  });

  it("carries the same safe list return context through the voucher route", () => {
    mocks.query = new URLSearchParams({ returnTo: "/admin/reservations?status=Confirmed&page=4" }).toString();
    render(<VoucherPage />);
    fireEvent.click(screen.getByRole("button", { name: "بازگشت به رزروها" }));
    expect(mocks.router.push).toHaveBeenCalledWith("/admin/reservations?status=Confirmed&page=4");
  });

  it("keeps private contents and write actions absent on a server-side property denial", async () => {
    mocks.request.mockRejectedValue(new Error("private details must not leak"));
    render(<DetailsPage />);
    await screen.findByRole("alert");
    expect(screen.queryByText("مهمان آزمون")).toBeNull();
    expect(screen.queryByText("private details must not leak")).toBeNull();
    expect(screen.queryByRole("button", { name: "لغو رزرو" })).toBeNull();
    expect(screen.queryByRole("button", { name: "ارجاع کار" })).toBeNull();
  });

  it("does not load financial endpoints or offer their actions without ManagePayments", async () => {
    mocks.session.platformRole = "AdminAssistant"; mocks.session.platformPermissions = [];
    render(<DetailsPage />);
    await screen.findByRole("heading", { level: 1, name: /R-/ });
    expect(mocks.request.mock.calls.some(([path]) => String(path).includes("/admin/manual-payments"))).toBe(false);
    expect(screen.queryByRole("button", { name: "مشاهده ووچر" })).toBeNull();
    expect(screen.queryByRole("button", { name: "ارجاع کار" })).toBeNull();
  });

  it("waits for the authenticated Admin workspace and does not request while unauthenticated", () => {
    mocks.session.loading = true;
    const { rerender } = render(<DetailsPage />);
    expect(mocks.request).not.toHaveBeenCalled();
    mocks.session.loading = false; mocks.session.authenticated = false;
    rerender(<DetailsPage />);
    expect(mocks.request).not.toHaveBeenCalled();
  });

  it.each(["abc", "0", "-1", "1.5"])("rejects malformed route ID %s without calling the API", async id => {
    mocks.id = id;
    render(<DetailsPage />);
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", "شناسه رزرو معتبر نیست.");
    expect(mocks.request).not.toHaveBeenCalled();
  });
});
