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
  KoochDatePicker: ({ value, onChange, label, minDate, maxDate }: {
    value: string | null;
    onChange: (value: string | null) => void;
    label: string;
    minDate?: string;
    maxDate?: string;
  }) => <input aria-label={label} data-min-date={minDate} data-max-date={maxDate}
    value={value ?? ""} onChange={(event) => onChange(event.target.value || null)} />,
}));

import AdminReportsPage from "@/app/admin/reports/page";
import { buildAdminReservationReportPath } from "@/lib/admin-reports";
import { formatLocalIsoDate, getCurrentJalaliPeriodRange } from "@/lib/date-utils";

function response(): AdminReservationReport {
  return {
    filters: { from: null, to: null, propertyIds: [], propertyTypes: [], status: null, timeZone: "UTC", fromUtcInclusive: null, toUtcExclusive: null },
    summary: {
      totalCount: 17,
      bookingValue: 12_500_000.75,
      bookingValueCurrency: "IRR",
      bookingValueHasMixedCurrencies: false,
      statusCounts: [{ status: "Confirmed", count: 12 }, { status: "PendingApproval", count: 5 }],
    },
    trend: [{ date: "2026-09-20", count: 17 }],
    properties: [{ propertyId: 101, propertyName: "اقامتگاه سرو", count: 17 }],
    statuses: [{ status: "Confirmed", count: 12 }, { status: "PendingApproval", count: 5 }],
    reportableProperties: [
      { id: 101, name: "اقامتگاه سرو" },
      { id: 102, name: "هتل آفتاب" },
    ],
  };
}

describe("Admin reservation count reports", () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.apiRequest.mockResolvedValue(response()); });

  it("requires ViewReports and renders returned counts with both charts as the default view", async () => {
    render(<AdminReportsPage />);
    expect(await screen.findByRole("heading", { name: "کل رزروها" })).toBeTruthy();
    expect(mocks.guard).toHaveBeenCalledWith("ViewReports");
    expect(mocks.apiRequest).toHaveBeenCalledWith("/admin/reports/reservations");
    const summary = screen.getByLabelText("خلاصه گزارش");
    expect(within(summary).getByText("۱۷")).toBeTruthy();
    expect(within(summary).getByText("۱۲")).toBeTruthy();
    expect(within(summary).getByText("۵")).toBeTruthy();
    expect(within(summary).getByRole("heading", { name: "ارزش رزروها" })).toBeTruthy();
    expect(within(summary).getByText("۱۲٬۵۰۰٬۰۰۰٫۷۵ ریال")).toBeTruthy();
    expect(screen.getByRole("img", { name: "نمودار روند ایجاد رزروها" })).toBeTruthy();
    expect(screen.getByRole("img", { name: "نمودار تفکیک اقامتگاه" })).toBeTruthy();
    expect(screen.queryByRole("table", { name: "روند ایجاد رزروها" })).toBeNull();
    expect(screen.queryByRole("table", { name: "تفکیک اقامتگاه" })).toBeNull();
    expect(screen.queryByText(/درآمد|اشغال|مبلغ/)).toBeNull();
  });

  it("switches each report panel independently and keeps existing table data available", async () => {
    render(<AdminReportsPage />);
    const trendHeading = await screen.findByRole("heading", { name: "روند ایجاد رزروها" });
    const propertyHeading = screen.getByRole("heading", { name: "تفکیک اقامتگاه" });
    const trendSection = trendHeading.closest("section") as HTMLElement;
    const propertySection = propertyHeading.closest("section") as HTMLElement;

    expect(within(trendSection).getByRole("button", { name: "نمودار" }).getAttribute("aria-pressed")).toBe("true");
    expect(within(propertySection).getByRole("button", { name: "نمودار" }).getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(within(trendSection).getByRole("button", { name: "جدول" }));
    expect(within(trendSection).getByRole("table", { name: "روند ایجاد رزروها" })).toBeTruthy();
    expect(within(trendSection).getByText("۱۷")).toBeTruthy();
    expect(within(propertySection).getByRole("img", { name: "نمودار تفکیک اقامتگاه" })).toBeTruthy();
    expect(within(propertySection).queryByRole("table")).toBeNull();

    fireEvent.click(within(propertySection).getByRole("button", { name: "جدول" }));
    expect(within(propertySection).getByRole("table", { name: "تفکیک اقامتگاه" })).toBeTruthy();
    expect(within(propertySection).getByText("اقامتگاه سرو")).toBeTruthy();
    expect(within(trendSection).getByRole("table", { name: "روند ایجاد رزروها" })).toBeTruthy();
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
    mocks.apiRequest.mockResolvedValue({
      ...response(),
      summary: {
        totalCount: 0,
        bookingValue: 0,
        bookingValueCurrency: null,
        bookingValueHasMixedCurrencies: false,
        statusCounts: [],
      },
      statuses: [], trend: [], properties: [],
    });
    render(<AdminReportsPage />);
    expect(await screen.findByText("رزروی مطابق این فیلترها یافت نشد.")).toBeTruthy();
    expect(within(screen.getByLabelText("خلاصه گزارش")).getAllByText("۰")).toHaveLength(2);
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.queryByRole("img", { name: /نمودار/ })).toBeNull();
  });

  it("shows a scoped empty state instead of an empty chart canvas", async () => {
    mocks.apiRequest.mockResolvedValue({ ...response(), trend: [], properties: [] });
    render(<AdminReportsPage />);
    expect(await screen.findByRole("heading", { name: "روند ایجاد رزروها" })).toBeTruthy();
    expect(screen.getAllByRole("status").filter((item) => item.textContent?.includes("داده‌ای برای نمایش نمودار وجود ندارد.")).length).toBe(2);
    expect(screen.queryByRole("img", { name: /نمودار/ })).toBeNull();
  });

  it("applies property and property-type drafts only after Apply; reset sends no stale filters", async () => {
    render(<AdminReportsPage />);
    await screen.findByLabelText("خلاصه گزارش");
    fireEvent.change(screen.getByLabelText("از تاریخ"), { target: { value: "2026-09-01" } });
    fireEvent.change(screen.getByLabelText("تا تاریخ"), { target: { value: "2026-09-20" } });
    fireEvent.change(screen.getByLabelText("وضعیت رزرو"), { target: { value: "PendingApproval" } });
    fireEvent.click(screen.getByLabelText("اقامتگاه"));
    fireEvent.click(await screen.findByRole("button", { name: "اقامتگاه سرو" }));
    fireEvent.click(screen.getByLabelText("نوع اقامتگاه"));
    fireEvent.click(await screen.findByRole("button", { name: /^هتل$/ }));
    fireEvent.click(await screen.findByRole("button", { name: "هتل بوتیک" }));
    expect(mocks.apiRequest).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "اعمال فیلتر" }));
    await waitFor(() => expect(mocks.apiRequest).toHaveBeenLastCalledWith(
      "/admin/reports/reservations?from=2026-09-01&to=2026-09-20&propertyIds=101&propertyTypes=Hotel&propertyTypes=BoutiqueHotel&status=PendingApproval",
    ));
    await screen.findByLabelText("خلاصه گزارش");
    fireEvent.click(screen.getByRole("button", { name: "پاک کردن فیلترها" }));
    await waitFor(() => expect(mocks.apiRequest).toHaveBeenLastCalledWith("/admin/reports/reservations"));
    expect(mocks.apiRequest.mock.calls.every(([path]) => String(path).startsWith("/admin/reports/reservations"))).toBe(true);
  });

  it("keeps distinct pending statuses", async () => {
    render(<AdminReportsPage />);
    await screen.findByLabelText("خلاصه گزارش");
    expect(screen.getByRole("option", { name: /^در انتظار$/ })).toBeTruthy();
    expect(screen.getByRole("option", { name: /^در انتظار تایید$/ })).toBeTruthy();
    expect(screen.getByRole("option", { name: /^در انتظار پرداخت$/ })).toBeTruthy();
  });

  it("disables end until start is selected and clearing start clears both dates", async () => {
    render(<AdminReportsPage />);
    await screen.findByLabelText("خلاصه گزارش");
    const start = screen.getByLabelText("از تاریخ") as HTMLInputElement;
    const end = screen.getByLabelText("تا تاریخ") as HTMLInputElement;
    expect(end.matches(":disabled")).toBe(true);

    fireEvent.change(start, { target: { value: "2026-09-10" } });
    expect(end.matches(":disabled")).toBe(false);
    expect(end.dataset.minDate).toBe("2026-09-10");
    fireEvent.change(end, { target: { value: "2026-09-20" } });
    fireEvent.click(screen.getByRole("button", { name: "پاک کردن از تاریخ" }));

    expect(start.value).toBe("");
    expect(end.value).toBe("");
    expect(end.matches(":disabled")).toBe(true);
  });

  it("uses today when start exists without an explicit end", async () => {
    render(<AdminReportsPage />);
    await screen.findByLabelText("خلاصه گزارش");
    fireEvent.change(screen.getByLabelText("از تاریخ"), { target: { value: "2026-09-01" } });
    fireEvent.click(screen.getByRole("button", { name: "اعمال فیلتر" }));
    await waitFor(() => expect(mocks.apiRequest).toHaveBeenLastCalledWith(
      `/admin/reports/reservations?from=2026-09-01&to=${formatLocalIsoDate(new Date())}`,
    ));
    expect((screen.getByLabelText("تا تاریخ") as HTMLInputElement).value).toBe("");
  });

  it("preserves an explicit end and prevents an earlier end through minDate", async () => {
    render(<AdminReportsPage />);
    await screen.findByLabelText("خلاصه گزارش");
    fireEvent.change(screen.getByLabelText("از تاریخ"), { target: { value: "2026-09-10" } });
    fireEvent.change(screen.getByLabelText("تا تاریخ"), { target: { value: "2026-09-20" } });
    expect((screen.getByLabelText("تا تاریخ") as HTMLInputElement).dataset.minDate).toBe("2026-09-10");
    fireEvent.click(screen.getByRole("button", { name: "اعمال فیلتر" }));
    await waitFor(() => expect(mocks.apiRequest).toHaveBeenLastCalledWith(
      "/admin/reports/reservations?from=2026-09-10&to=2026-09-20",
    ));

    fireEvent.change(screen.getByLabelText("از تاریخ"), { target: { value: "2026-09-21" } });
    expect((screen.getByLabelText("تا تاریخ") as HTMLInputElement).value).toBe("");
  });

  it.each([
    ["این هفته", "week"],
    ["این ماه", "month"],
    ["این فصل", "quarter"],
  ] as const)("populates both controls for %s", async (buttonName, period) => {
    render(<AdminReportsPage />);
    await screen.findByLabelText("خلاصه گزارش");
    fireEvent.click(screen.getByRole("button", { name: buttonName }));
    const expected = getCurrentJalaliPeriodRange(period);
    expect((screen.getByLabelText("از تاریخ") as HTMLInputElement).value).toBe(expected.startDate);
    expect((screen.getByLabelText("تا تاریخ") as HTMLInputElement).value).toBe(expected.endDate);
  });

  it("keeps all-time semantics when both dates are empty", async () => {
    render(<AdminReportsPage />);
    await screen.findByLabelText("خلاصه گزارش");
    fireEvent.click(screen.getByRole("button", { name: "اعمال فیلتر" }));
    await waitFor(() => expect(mocks.apiRequest).toHaveBeenLastCalledWith("/admin/reports/reservations"));
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

describe("Admin reservation report query contract", () => {
  const empty = {
    startDate: null,
    endDate: null,
    propertyIds: [],
    propertyTypes: [],
    status: "" as const,
  };

  it("omits empty property and type selections", () => {
    expect(buildAdminReservationReportPath(empty)).toBe("/admin/reports/reservations");
  });

  it("uses repeated query keys for one or multiple properties and property types", () => {
    expect(buildAdminReservationReportPath({
      ...empty,
      propertyIds: ["101"],
      propertyTypes: ["Hotel"],
    })).toBe("/admin/reports/reservations?propertyIds=101&propertyTypes=Hotel");

    expect(buildAdminReservationReportPath({
      ...empty,
      propertyIds: ["101", "102"],
      propertyTypes: ["Hotel", "BoutiqueHotel"],
    })).toBe(
      "/admin/reports/reservations?propertyIds=101&propertyIds=102&propertyTypes=Hotel&propertyTypes=BoutiqueHotel",
    );
  });
});

describe("current Jalali calendar presets", () => {
  const today = new Date(2026, 8, 23, 12);

  it("uses the current Saturday-to-Friday week", () => {
    expect(getCurrentJalaliPeriodRange("week", today)).toEqual({
      startDate: "2026-09-19",
      endDate: "2026-09-25",
    });
  });

  it("uses the current Jalali month", () => {
    expect(getCurrentJalaliPeriodRange("month", today)).toEqual({
      startDate: "2026-09-23",
      endDate: "2026-10-22",
    });
  });

  it("uses the current Jalali quarter", () => {
    expect(getCurrentJalaliPeriodRange("quarter", today)).toEqual({
      startDate: "2026-09-23",
      endDate: "2026-12-21",
    });
  });
});
