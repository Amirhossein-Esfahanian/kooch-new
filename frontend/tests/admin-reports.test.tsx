import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminReservationReport } from "@/lib/admin-reports";

const mocks = vi.hoisted(() => ({ apiRequest: vi.fn(), guard: vi.fn() }));
vi.mock("@/lib/owner-api", () => ({ apiRequest: mocks.apiRequest }));
vi.mock("@/components/dashboard/DashboardLayouts", () => ({
  AdminLayout: ({ children, requiredPlatformPermission }: { children: ReactNode; requiredPlatformPermission: string }) => {
    mocks.guard(requiredPlatformPermission);
    return children;
  },
}));
vi.mock("@/components/KoochDatePicker", () => ({
  KoochDatePicker: ({ value, onChange }: { value: { startDate: string | null; endDate: string | null }; onChange: (value: { startDate: string | null; endDate: string | null }) => void }) => <>
    <input aria-label="از تاریخ" value={value.startDate ?? ""} onChange={(event) => onChange({ ...value, startDate: event.target.value })} />
    <input aria-label="تا تاریخ" value={value.endDate ?? ""} onChange={(event) => onChange({ ...value, endDate: event.target.value })} />
  </>,
}));

import AdminReportsPage from "@/app/admin/reports/page";

function response(): AdminReservationReport {
  return {
    filters: { from: null, to: null, propertyId: null, status: null, timeZone: "UTC", fromUtcInclusive: null, toUtcExclusive: null },
    summary: { totalCount: 17, statusCounts: [{ status: "Confirmed", count: 12 }, { status: "PendingApproval", count: 5 }] },
    trend: [{ date: "2026-09-20", count: 17 }],
    properties: [{ propertyId: 101, propertyName: "اقامتگاه سرو", count: 17 }],
    statuses: [{ status: "Confirmed", count: 12 }, { status: "PendingApproval", count: 5 }],
    reportableProperties: [{ id: 101, name: "اقامتگاه سرو" }],
  };
}

describe("Admin reservation count reports", () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.apiRequest.mockResolvedValue(response()); });

  it("requires ViewReports and renders only returned counts and breakdowns", async () => {
    render(<AdminReportsPage />);
    expect(await screen.findByRole("heading", { name: "کل رزروها" })).toBeTruthy();
    expect(mocks.guard).toHaveBeenCalledWith("ViewReports");
    expect(mocks.apiRequest).toHaveBeenCalledWith("/admin/reports/reservations");
    const summary = screen.getByLabelText("خلاصه گزارش");
    expect(within(summary).getByText("۱۷")).toBeTruthy();
    expect(within(summary).getByText("۱۲")).toBeTruthy();
    expect(within(summary).getByText("۵")).toBeTruthy();
    expect(within(screen.getByRole("table", { name: "تفکیک اقامتگاه" })).getByText("اقامتگاه سرو")).toBeTruthy();
    expect(screen.getByRole("table", { name: "روند ایجاد رزروها" })).toBeTruthy();
    expect(screen.queryByText(/درآمد|اشغال|مبلغ/)).toBeNull();
  });

  it("shows loading without static KPI values", () => {
    mocks.apiRequest.mockReturnValue(new Promise(() => {}));
    render(<AdminReportsPage />);
    expect(screen.getByRole("status").textContent).toContain("در حال دریافت گزارش");
    expect(screen.queryByLabelText("خلاصه گزارش")).toBeNull();
  });

  it("shows an error and retries the same report request", async () => {
    mocks.apiRequest.mockRejectedValueOnce(new Error("گزارش در دسترس نیست"));
    render(<AdminReportsPage />);
    expect(await screen.findByText("گزارش در دسترس نیست")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "تلاش دوباره" }));
    expect(await screen.findByLabelText("خلاصه گزارش")).toBeTruthy();
    expect(mocks.apiRequest).toHaveBeenCalledTimes(2);
  });

  it("shows a real empty result and zero total", async () => {
    mocks.apiRequest.mockResolvedValue({ ...response(), summary: { totalCount: 0, statusCounts: [] }, statuses: [], trend: [], properties: [] });
    render(<AdminReportsPage />);
    expect(await screen.findByText("رزروی مطابق این فیلترها یافت نشد.")).toBeTruthy();
    expect(within(screen.getByLabelText("خلاصه گزارش")).getByText("۰")).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("applies dates, scoped property and normalized status only after Apply; reset clears them", async () => {
    render(<AdminReportsPage />);
    await screen.findByLabelText("خلاصه گزارش");
    fireEvent.change(screen.getByLabelText("از تاریخ"), { target: { value: "2026-09-01" } });
    fireEvent.change(screen.getByLabelText("تا تاریخ"), { target: { value: "2026-09-20" } });
    fireEvent.change(screen.getByLabelText("وضعیت رزرو"), { target: { value: "PendingApproval" } });
    fireEvent.click(screen.getByLabelText("اقامتگاه"));
    fireEvent.click(await screen.findByRole("button", { name: "اقامتگاه سرو" }));
    expect(mocks.apiRequest).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "اعمال فیلتر" }));
    await waitFor(() => expect(mocks.apiRequest).toHaveBeenLastCalledWith("/admin/reports/reservations?from=2026-09-01&to=2026-09-20&propertyId=101&status=PendingApproval"));
    await screen.findByLabelText("خلاصه گزارش");
    fireEvent.click(screen.getByRole("button", { name: "پاک کردن فیلترها" }));
    await waitFor(() => expect(mocks.apiRequest).toHaveBeenLastCalledWith("/admin/reports/reservations"));
    expect(mocks.apiRequest.mock.calls.every(([path]) => String(path).startsWith("/admin/reports/reservations"))).toBe(true);
  });

  it("keeps distinct pending statuses and blocks reversed dates", async () => {
    render(<AdminReportsPage />);
    await screen.findByLabelText("خلاصه گزارش");
    expect(screen.getByRole("option", { name: "در انتظار", exact: true })).toBeTruthy();
    expect(screen.getByRole("option", { name: "در انتظار تایید", exact: true })).toBeTruthy();
    expect(screen.getByRole("option", { name: "در انتظار پرداخت", exact: true })).toBeTruthy();
    fireEvent.change(screen.getByLabelText("از تاریخ"), { target: { value: "2026-09-21" } });
    fireEvent.change(screen.getByLabelText("تا تاریخ"), { target: { value: "2026-09-20" } });
    expect(screen.getByRole("alert").textContent).toContain("تاریخ پایان نباید");
    expect((screen.getByRole("button", { name: "اعمال فیلتر" }) as HTMLButtonElement).disabled).toBe(true);
    expect(mocks.apiRequest).toHaveBeenCalledTimes(1);
  });

  it("does not present stale data as a successful filtered report after failure", async () => {
    render(<AdminReportsPage />);
    await screen.findByLabelText("خلاصه گزارش");
    mocks.apiRequest.mockRejectedValueOnce(new Error("عدم دسترسی"));
    fireEvent.change(screen.getByLabelText("وضعیت رزرو"), { target: { value: "Cancelled" } });
    fireEvent.click(screen.getByRole("button", { name: "اعمال فیلتر" }));
    await screen.findByText("عدم دسترسی");
    expect(screen.queryByLabelText("خلاصه گزارش")).toBeNull();
    expect((screen.getByLabelText("وضعیت رزرو") as HTMLSelectElement).value).toBe("Cancelled");
  });

  it("ignores a response arriving after unmount", async () => {
    let resolve!: (value: AdminReservationReport) => void;
    mocks.apiRequest.mockReturnValue(new Promise<AdminReservationReport>((complete) => { resolve = complete; }));
    const view = render(<AdminReportsPage />);
    view.unmount();
    await act(async () => resolve(response()));
    expect(screen.queryByLabelText("خلاصه گزارش")).toBeNull();
  });
});
