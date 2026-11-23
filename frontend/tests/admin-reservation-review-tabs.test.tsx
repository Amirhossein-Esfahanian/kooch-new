import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReservationTableItem } from "@/components/reservations/ReservationTable";

const mocks = vi.hoisted(() => ({ request: vi.fn(), push: vi.fn(), replace: vi.fn(), permissions: ["ManagePayments"] as string[] }));
vi.mock("next/navigation", async () => {
  const { useSyncExternalStore } = await import("react");
  const subscribe = (notify: () => void) => { window.addEventListener("popstate", notify); return () => window.removeEventListener("popstate", notify); };
  return { useRouter: () => ({ push: mocks.push, replace: mocks.replace }),
    useSearchParams: () => new URLSearchParams(useSyncExternalStore(subscribe, () => window.location.search)) };
});
vi.mock("@/components/auth/AuthSessionProvider", () => ({ useAuthSession: () => ({
  platformRole: "AdminAssistant", platformPermissions: mocks.permissions, authenticated: true, loading: false, workspaces: ["admin"],
}) }));
vi.mock("@/components/dashboard/DashboardLayouts", () => ({ AdminLayout: ({ children }: { children: ReactNode }) => children }));
vi.mock("@/components/reservations/ManualReservationDialog", () => ({ ManualReservationDialog: () => null }));
vi.mock("@/components/reservations/ReservationDetailsDialog", () => ({ ReservationDetailsDialog: () => null }));
vi.mock("@/components/reservations/ReservationTable", () => ({ ReservationTable: (props: {
  currentPage: number; onPageChange: (page: number) => void; detailsHref: (item: ReservationTableItem) => string;
}) => <div><span>صفحه رزروها {props.currentPage}</span><button onClick={() => props.onPageChange(props.currentPage + 1)}>صفحه بعد رزروها</button>
  <a href={props.detailsHref({ id: 37 } as ReservationTableItem)}>جزئیات رزرو آزمون</a></div> }));
vi.mock("@/lib/owner-api", async original => ({ ...(await original<typeof import("@/lib/owner-api")>()), apiRequest: mocks.request }));
vi.mock("@/lib/currency", async original => ({ ...(await original<typeof import("@/lib/currency")>()), useSiteCurrencyLabel: () => "ریال" }));

import AdminReservationsPage from "@/app/admin/reservations/page";

function navigate(href: string) { window.history.pushState({}, "", href); window.dispatchEvent(new PopStateEvent("popstate")); }
const receipt = { paymentId: 1, reservationId: 37, reservationNumber: "R-37", orderCode: "O-12", propertyId: 3,
  propertyName: "اقامتگاه آزمون", guestName: "مهمان آزمون", amount: 5000000, currency: "IRR", method: "BankTransfer",
  createdAtUtc: "2026-11-20T12:00:00Z", paymentExpiresAtUtc: "2026-11-21T12:00:00Z",
  reviewProtectionExpiresAtUtc: "2026-11-22T12:00:00Z", reservationStatus: "ApprovedAwaitingPayment", reviewState: "Protected" };

describe("Admin reservations review tab integration", () => {
  beforeEach(() => {
    vi.clearAllMocks(); mocks.permissions = ["ManagePayments"];
    window.history.replaceState({}, "", "/admin/reservations");
    mocks.push.mockImplementation(navigate);
    mocks.request.mockImplementation(async (path: string) => {
      const url = new URL(path, "https://test.invalid");
      if (url.pathname === "/admin/manual-payments/pending") return { items: [receipt], totalCount: 25,
        page: Number(url.searchParams.get("page")), pageSize: Number(url.searchParams.get("pageSize")), totalPages: 2 };
      if (url.pathname === "/admin/reservations") return { items: [], totalCount: 50, page: 1, pageSize: 10, totalPages: 5 };
      return [];
    });
  });

  it("defaults to reservations, opens reviews from the compact notice and preserves filters and both page states", async () => {
    window.history.replaceState({}, "", "/admin/reservations?propertyId=3&status=Confirmed&page=4");
    render(<AdminReservationsPage />);
    expect(screen.getByRole("tab", { name: "همه رزروها" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByText("صفحه رزروها 4")).toBeTruthy();
    await screen.findByText("پرداخت‌های در انتظار بررسی · ۲۵");
    expect(screen.queryByRole("link", { name: "بررسی پرداخت R-37" })).toBeNull();
    expect(mocks.request.mock.calls.some(([path]) => String(path).includes("pageSize=20"))).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "بررسی پرداخت‌ها" }));
    const link = await screen.findByRole("link", { name: "بررسی پرداخت R-37" });
    expect(mocks.push).toHaveBeenLastCalledWith("/admin/reservations?propertyId=3&status=Confirmed&page=4&tab=payments", { scroll: false });
    expect(screen.queryByText("پرداخت‌های در انتظار بررسی · ۲۵")).toBeNull();
    expect(screen.queryByRole("button", { name: "اعمال" })).toBeNull();
    expect(new URL(link.getAttribute("href")!, "https://test.invalid").searchParams.get("returnTo"))
      .toBe("/admin/reservations?propertyId=3&status=Confirmed&page=4&tab=payments");
    fireEvent.click(screen.getByRole("button", { name: "بعدی" }));
    await screen.findByText("صفحه ۲ · ۲۵ رسید");
    fireEvent.click(screen.getByRole("tab", { name: "همه رزروها" }));
    expect(screen.getByText("صفحه رزروها 4")).toBeTruthy();
    const origin = new URL(screen.getByRole("link", { name: "جزئیات رزرو آزمون" }).getAttribute("href")!, "https://test.invalid").searchParams.get("returnTo");
    expect(origin).toBe("/admin/reservations?propertyId=3&status=Confirmed&page=4");
    fireEvent.click(screen.getByRole("tab", { name: /بررسی پرداخت‌ها/ }));
    await screen.findByText("صفحه ۲ · ۲۵ رسید");
    expect(mocks.request).toHaveBeenCalledWith("/admin/manual-payments/pending?page=2&pageSize=20&propertyId=3", expect.anything());
    expect(mocks.request.mock.calls.filter(([path]) => String(path).startsWith("/admin/reservations?"))).toHaveLength(1);
  });

  it("supports direct entry, reload and history navigation using the URL tab", async () => {
    window.history.replaceState({}, "", "/admin/reservations?tab=payments&page=3");
    const view = render(<AdminReservationsPage />);
    await screen.findByRole("link", { name: "بررسی پرداخت R-37" });
    expect(screen.getByRole("tab", { name: /بررسی پرداخت‌ها/ }).getAttribute("aria-selected")).toBe("true");
    view.unmount(); const reloaded = render(<AdminReservationsPage />);
    await screen.findByRole("link", { name: "بررسی پرداخت R-37" });
    fireEvent.click(screen.getByRole("tab", { name: "همه رزروها" }));
    expect(screen.getByText("صفحه رزروها 3")).toBeTruthy();
    await act(async () => { window.history.back(); });
    await waitFor(() => expect(screen.getByRole("tab", { name: /بررسی پرداخت‌ها/ }).getAttribute("aria-selected")).toBe("true"));
    await act(async () => { window.history.forward(); });
    await waitFor(() => expect(screen.getByRole("tab", { name: "همه رزروها" }).getAttribute("aria-selected")).toBe("true"));
    reloaded.unmount();
  });

  it("uses manual RTL keyboard activation with linked panels and roving focus", async () => {
    render(<AdminReservationsPage />);
    const first = screen.getByRole("tab", { name: "همه رزروها" });
    const second = screen.getByRole("tab", { name: /بررسی پرداخت‌ها/ });
    first.focus(); fireEvent.keyDown(first, { key: "ArrowLeft" });
    expect(document.activeElement).toBe(second); expect(second.tabIndex).toBe(0); expect(first.tabIndex).toBe(-1);
    expect(first.getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(second, { key: "Enter" });
    await screen.findByRole("link", { name: "بررسی پرداخت R-37" });
    expect(screen.getByRole("tabpanel").id).toBe(second.getAttribute("aria-controls"));
    fireEvent.keyDown(second, { key: "Home" }); expect(document.activeElement).toBe(first);
    fireEvent.keyDown(first, { key: "End" }); expect(document.activeElement).toBe(second);
    fireEvent.keyDown(second, { key: "ArrowRight" }); expect(document.activeElement).toBe(first);
    fireEvent.keyDown(first, { key: " " }); expect(first.getAttribute("aria-selected")).toBe("true");
  });

  it("keeps a draft search value when switching panels and falls back safely for invalid or unauthorized tabs", async () => {
    window.history.replaceState({}, "", "/admin/reservations?tab=unknown");
    const view = render(<AdminReservationsPage />);
    const search = screen.getByLabelText("مهمان");
    fireEvent.change(search, { target: { value: "جستجوی مهمان" } });
    fireEvent.click(screen.getByRole("tab", { name: /بررسی پرداخت‌ها/ }));
    await screen.findByRole("link", { name: "بررسی پرداخت R-37" });
    fireEvent.click(screen.getByRole("tab", { name: "همه رزروها" }));
    expect((screen.getByLabelText("مهمان") as HTMLInputElement).value).toBe("جستجوی مهمان");
    view.unmount(); mocks.permissions = []; mocks.request.mockClear();
    window.history.replaceState({}, "", "/admin/reservations?tab=payments");
    render(<AdminReservationsPage />);
    expect(within(screen.getByRole("tablist")).getAllByRole("tab")).toHaveLength(1);
    expect(mocks.request.mock.calls.some(([path]) => String(path).includes("manual-payments"))).toBe(false);
  });
});
