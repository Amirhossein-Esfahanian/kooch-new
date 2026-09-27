import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => vi.fn());
vi.mock("@/lib/owner-api", () => ({ apiRequest: api }));
vi.mock("@/lib/currency", async importOriginal => ({
  ...await importOriginal<typeof import("@/lib/currency")>(),
  useSiteCurrencyLabel: () => "واحد آزمایشی",
}));
vi.mock("@/components/dashboard/DashboardLayouts", () => ({
  AdminLayout: ({ children, requiredPlatformPermission }: { children: ReactNode; requiredPlatformPermission: string }) =>
    <div data-permission={requiredPlatformPermission}>{children}</div>,
}));
import Page from "@/app/admin/settlements/page";

const payables = [
  { id: 1, status: "Due", propertyId: 1, currency: "IRR" },
  { id: 2, status: "Overdue", propertyId: 1, currency: "IRR" },
  { id: 3, status: "Future", propertyId: 1, currency: "IRR" },
  { id: 4, status: "Due", propertyId: 2, currency: "IRR" },
  { id: 5, status: "Due", propertyId: 1, currency: "USD" },
].map(item => ({ ...item, propertyName: `Property ${item.propertyId}`, reservationNumber: `R-10000${item.id}`,
  amount: 123.45, payableDueDate: "2026-09-27" }));
const batch = { id: 10, propertyId: 1, propertyName: "Property 1", totalAmount: 246.9, currency: "IRR",
  itemCount: 2, status: "Due", createdAtUtc: "2026-09-27T00:00:00Z", paidAtUtc: null, isEarlySettlement: false };
const paged = (items: unknown[]) => ({ items, totalCount: items.length, page: 1, pageSize: 20, totalPages: 1 });
const mutations = () => api.mock.calls.filter(([, options]) => options?.method === "POST");
const check = (id: number) => screen.getByRole<HTMLInputElement>("checkbox", { name: `انتخاب R-10000${id}` });

beforeEach(() => {
  api.mockReset();
  api.mockImplementation(async (path: string, options?: RequestInit) => {
    if (options?.method === "POST") return { ...batch, status: "Paid", items: [] };
    if (path.includes("/properties?")) return paged([{ id: 1, name: "Property 1" }]);
    if (path.includes("/payables?")) return paged(payables);
    if (path === "/admin/settlements/10") return { ...batch, items: [
      { financialEntryId: 1, reservationNumber: "R-100001", amount: 123.45, payableDueDate: "2026-09-27" },
    ] };
    return paged([batch]);
  });
});

describe("Admin settlements", () => {
  it("selects due/overdue entries and creates a normal batch with the existing contract", async () => {
    render(<Page />);
    fireEvent.click(await screen.findByRole("checkbox", { name: "انتخاب R-100001" }));
    fireEvent.click(check(2));
    expect(check(3).disabled).toBe(true);
    expect(screen.getByText("۲ قلم انتخاب‌شده • Property 1")).not.toBeNull();
    expect(screen.getByText("مجموع: ۲۴۶٫۹ واحد آزمایشی")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "ایجاد تسویه" }));
    await waitFor(() => expect(mutations()).toHaveLength(1));
    expect(mutations()[0][0]).toBe("/admin/settlements");
    expect(JSON.parse(mutations()[0][1].body)).toEqual({ propertyId: 1, payableEntryIds: [1, 2], allowEarlySettlement: false });
  });

  it("blocks future items until explicit early intent and sends that intent", async () => {
    render(<Page />);
    const future = await screen.findByRole<HTMLInputElement>("checkbox", { name: "انتخاب R-100003" });
    expect(future.disabled).toBe(true);
    fireEvent.click(screen.getByRole("checkbox", { name: "اجازه تسویه زودهنگام اقلام آینده" }));
    expect(future.disabled).toBe(false);
    fireEvent.click(future);
    fireEvent.click(screen.getByRole("button", { name: "ایجاد تسویه" }));
    await waitFor(() => expect(mutations()).toHaveLength(1));
    expect(JSON.parse(mutations()[0][1].body)).toEqual({ propertyId: 1, payableEntryIds: [3], allowEarlySettlement: true });
  });

  it("removes future selection when early intent is turned off", async () => {
    render(<Page />);
    await screen.findByRole("checkbox", { name: "انتخاب R-100003" });
    const early = screen.getByRole("checkbox", { name: "اجازه تسویه زودهنگام اقلام آینده" });
    fireEvent.click(early); fireEvent.click(check(3)); fireEvent.click(early);
    expect(check(3).checked).toBe(false);
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "ایجاد تسویه" }).disabled).toBe(true);
  });

  it("prevents mixing property or currency and unlocks after deselection", async () => {
    render(<Page />);
    fireEvent.click(await screen.findByRole("checkbox", { name: "انتخاب R-100001" }));
    expect(check(4).disabled).toBe(true); expect(check(5).disabled).toBe(true); expect(check(2).disabled).toBe(false);
    fireEvent.click(check(1));
    expect(check(4).disabled).toBe(false); expect(check(5).disabled).toBe(false);
  });

  it("confirms Paid before posting and refreshes the current lists", async () => {
    render(<Page />);
    fireEvent.click(await screen.findByRole("button", { name: "ثبت تسویه" }));
    const dialog = await screen.findByRole("alertdialog", { name: "ثبت تسویه" });
    expect(mutations()).toHaveLength(0);
    fireEvent.click(within(dialog).getByRole("button", { name: "تأیید و ثبت تسویه" }));
    await waitFor(() => expect(mutations()).toHaveLength(1));
    expect(mutations()[0]).toEqual(["/admin/settlements/10/paid", { method: "POST" }]);
    await waitFor(() => expect(api.mock.calls.filter(([path]) => path === "/admin/settlements?page=1&pageSize=20").length).toBe(2));
  });

  it("loads persisted batch details including original due dates and reservation references", async () => {
    render(<Page />);
    fireEvent.click(await screen.findByRole("button", { name: "جزئیات" }));
    const dialog = await screen.findByRole("dialog", { name: "جزئیات تسویه" });
    await within(dialog).findByText("R-100001");
    expect(within(dialog).getByText("سررسید اصلی")).not.toBeNull();
    expect(within(dialog).getByText("زمان ایجاد")).not.toBeNull();
    expect(within(dialog).getByText("زمان پرداخت")).not.toBeNull();
    expect(dialog.querySelector('time[datetime="2026-09-27T00:00:00Z"]')?.children.length).toBe(2);
    expect(api).toHaveBeenCalledWith("/admin/settlements/10");
  });

  it("uses compact responsive sections and configured currency without currency columns", async () => {
    render(<Page />);
    await screen.findByRole("checkbox", { name: "انتخاب R-100001" });
    const payableTable = screen.getByRole("table", { name: "تعهدات تسویه‌نشده" });
    const settlementTable = screen.getByRole("table", { name: "تسویه‌ها" });
    expect(within(payableTable).getAllByRole("columnheader")).toHaveLength(6);
    expect(within(settlementTable).getAllByRole("columnheader")).toHaveLength(6);
    expect(screen.queryByRole("columnheader", { name: "واحد پول" })).toBeNull();
    expect(within(payableTable).getAllByText("۱۲۳٫۴۵")).toHaveLength(5);
    expect(within(settlementTable).getByText("۲۴۶٫۹")).not.toBeNull();
    expect(within(payableTable).queryByText(/واحد آزمایشی/)).toBeNull();
    expect(within(settlementTable).queryByText(/واحد آزمایشی/)).toBeNull();
    expect(screen.getAllByText("واحد مبالغ: واحد آزمایشی")).toHaveLength(2);
    const payableSection = screen.getByRole("region", { name: "تعهدات تسویه‌نشده" });
    const settlementSection = screen.getByRole("region", { name: "تسویه‌ها" });
    expect(payableSection.parentElement).toBe(settlementSection.parentElement);
    expect(payableSection.parentElement?.classList.contains("lg:grid-cols-2")).toBe(true);
    expect(screen.queryByRole("button", { name: "پاک کردن فیلتر" })).toBeNull();
    expect(screen.queryByRole("button", { name: "همه اقامتگاه‌ها" })).toBeNull();
  });

  it("offers reset only after selecting a property and preserves the filter requests", async () => {
    render(<Page />);
    await screen.findByRole("checkbox", { name: "انتخاب R-100001" });
    fireEvent.click(screen.getByRole("button", { name: "اقامتگاه" }));
    fireEvent.click(await screen.findByRole("button", { name: "Property 1" }));
    const reset = await screen.findByRole("button", { name: "پاک کردن فیلتر" });
    await waitFor(() => expect(api).toHaveBeenCalledWith("/admin/settlements/payables?page=1&pageSize=20&propertyId=1"));
    fireEvent.click(reset);
    expect(screen.queryByRole("button", { name: "پاک کردن فیلتر" })).toBeNull();
  });

  it("uses distinct normal and early empty wording", async () => {
    const original = api.getMockImplementation()!;
    api.mockImplementation((path: string, options?: RequestInit) => path.includes("/payables?")
      ? Promise.resolve(paged([])) : original(path, options));
    render(<Page />);
    await screen.findByText("در حال حاضر تعهد سررسیدشده یا معوقی برای تسویه وجود ندارد.");
    fireEvent.click(screen.getByRole("checkbox", { name: "اجازه تسویه زودهنگام اقلام آینده" }));
    expect(screen.getByText("تعهد تسویه‌نشده‌ای یافت نشد.")).not.toBeNull();
  });
});
