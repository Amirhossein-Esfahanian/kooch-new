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
const batch = { id: 10, settlementNumber: "S-583214", propertyId: 1, propertyName: "Property 1", totalAmount: 246.9, currency: "IRR",
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
  it("uses the public settlement reference while keeping reservation references on items", async () => {
    render(<Page />);
    await screen.findByText("S-583214");
    expect(screen.queryByText("۱۰")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "جزئیات" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("S-583214")).not.toBeNull();
    expect(within(dialog).getByText("R-100001")).not.toBeNull();
    expect(api).toHaveBeenCalledWith("/admin/settlements/10");
  });
  it("applies independent server filters/sorts while the Property selector remains shared", async () => {
    render(<Page />);
    await screen.findByRole("checkbox", { name: "انتخاب R-100001" });
    fireEvent.click(screen.getByRole("button", { name: "اقامتگاه" }));
    fireEvent.click(await screen.findByRole("button", { name: "Property 1" }));
    await waitFor(() => expect(api).toHaveBeenCalledWith("/admin/settlements?page=1&pageSize=20&propertyId=1"));
    expect(screen.getByRole("button", { name: "فیلتر و مرتب‌سازی تعهدات" }).textContent).toBe("");
    expect(screen.getByRole("button", { name: "فیلتر و مرتب‌سازی تسویه‌ها" }).textContent).toBe("");
    fireEvent.click(screen.getByRole("button", { name: "فیلتر و مرتب‌سازی تعهدات" }));
    let dialog = await screen.findByRole("dialog", { name: "فیلتر و مرتب‌سازی تعهدات" });
    fireEvent.change(within(dialog).getByRole("combobox", { name: "وضعیت" }), { target: { value: "Future" } });
    fireEvent.change(within(dialog).getByRole("textbox", { name: "شماره رزرو" }), { target: { value: " R-100003 " } });
    fireEvent.change(within(dialog).getByRole("combobox", { name: "مرتب‌سازی بر اساس" }), { target: { value: "Amount" } });
    fireEvent.change(within(dialog).getByRole("combobox", { name: "ترتیب" }), { target: { value: "Desc" } });
    expect(api.mock.calls.some(([path]) => path.includes("status=Future"))).toBe(false);
    fireEvent.click(within(dialog).getByRole("button", { name: "اعمال" }));
    await waitFor(() => expect(api).toHaveBeenCalledWith("/admin/settlements/payables?page=1&pageSize=20&propertyId=1&status=Future&search=R-100003&sortBy=Amount&sortDirection=Desc"));
    expect(screen.getByRole("button", { name: /فیلتر و مرتب‌سازی تعهدات، ۳/ })).not.toBeNull();
    expect(check(3).disabled).toBe(true);
    expect(api.mock.calls.filter(([path]) => path.startsWith("/admin/settlements?")).length).toBe(2);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "فیلتر و مرتب‌سازی تسویه‌ها" }));
    dialog = await screen.findByRole("dialog", { name: "فیلتر و مرتب‌سازی تسویه‌ها" });
    expect(within(dialog).getByRole("option", { name: "لغوشده" }).getAttribute("value")).toBe("Cancelled");
    fireEvent.change(within(dialog).getByRole("combobox", { name: "وضعیت" }), { target: { value: "Cancelled" } });
    fireEvent.change(within(dialog).getByRole("combobox", { name: "مرتب‌سازی بر اساس" }), { target: { value: "ItemCount" } });
    fireEvent.change(within(dialog).getByRole("combobox", { name: "ترتیب" }), { target: { value: "Asc" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "اعمال" }));
    await waitFor(() => expect(api).toHaveBeenCalledWith("/admin/settlements?page=1&pageSize=20&propertyId=1&status=Cancelled&sortBy=ItemCount&sortDirection=Asc"));
    expect(screen.getByRole("button", { name: /فیلتر و مرتب‌سازی تسویه‌ها، ۲/ })).not.toBeNull();
    expect(api.mock.calls.filter(([path]) => path.includes("/payables?")).length).toBe(3);
  });

  it("discards unapplied changes and resets only the selected table to its defaults", async () => {
    render(<Page />);
    await screen.findByRole("button", { name: "جزئیات" });
    fireEvent.click(screen.getByRole("button", { name: "فیلتر و مرتب‌سازی تعهدات" }));
    let dialog = await screen.findByRole("dialog", { name: "فیلتر و مرتب‌سازی تعهدات" });
    fireEvent.change(within(dialog).getByRole("combobox", { name: "وضعیت" }), { target: { value: "Due" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "انصراف" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(api.mock.calls.filter(([path]) => path.includes("/payables?")).length).toBe(1);
    fireEvent.click(screen.getByRole("button", { name: "فیلتر و مرتب‌سازی تعهدات" }));
    dialog = await screen.findByRole("dialog", { name: "فیلتر و مرتب‌سازی تعهدات" });
    expect(within(dialog).getByRole<HTMLSelectElement>("combobox", { name: "وضعیت" }).value).toBe("");
    fireEvent.change(within(dialog).getByRole("combobox", { name: "وضعیت" }), { target: { value: "Overdue" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "اعمال" }));
    await waitFor(() => expect(api).toHaveBeenCalledWith("/admin/settlements/payables?page=1&pageSize=20&status=Overdue"));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    fireEvent.click(screen.getByRole("button", { name: /فیلتر و مرتب‌سازی تعهدات، ۱/ }));
    dialog = await screen.findByRole("dialog", { name: "فیلتر و مرتب‌سازی تعهدات" });
    fireEvent.click(within(dialog).getByRole("button", { name: "پاک کردن" }));
    expect(api.mock.calls.filter(([path]) => path === "/admin/settlements/payables?page=1&pageSize=20")).toHaveLength(1);
    expect(within(dialog).getByRole<HTMLSelectElement>("combobox", { name: "وضعیت" }).value).toBe("");
    fireEvent.click(within(dialog).getByRole("button", { name: "اعمال" }));
    await waitFor(() => expect(api.mock.calls.filter(([path]) => path === "/admin/settlements/payables?page=1&pageSize=20")).toHaveLength(2));
    expect(api.mock.calls.filter(([path]) => path.startsWith("/admin/settlements?")).length).toBe(1);
    expect(screen.getByRole("button", { name: "فیلتر و مرتب‌سازی تعهدات" }).textContent).toBe("");
  });

  it("shows a matching-results empty state rather than claiming no settlements exist", async () => {
    const original = api.getMockImplementation()!;
    api.mockImplementation((path: string, options?: RequestInit) => path.startsWith("/admin/settlements?") && path.includes("status=Paid")
      ? Promise.resolve(paged([])) : original(path, options));
    render(<Page />);
    await screen.findByRole("button", { name: "جزئیات" });
    fireEvent.click(screen.getByRole("button", { name: "فیلتر و مرتب‌سازی تسویه‌ها" }));
    const dialog = await screen.findByRole("dialog", { name: "فیلتر و مرتب‌سازی تسویه‌ها" });
    fireEvent.change(within(dialog).getByRole("combobox", { name: "وضعیت" }), { target: { value: "Paid" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "اعمال" }));
    await screen.findByText("نتیجه‌ای با این فیلترها یافت نشد.");
    expect(screen.queryByText("تسویه‌ای ثبت نشده است.")).toBeNull();
  });

  it("resets each table's page on Apply and retains its filters on later pages", async () => {
    const original = api.getMockImplementation()!;
    api.mockImplementation(async (path: string, options?: RequestInit) => {
      const result = await original(path, options);
      return path.includes("/payables?") || path.startsWith("/admin/settlements?")
        ? { ...result, totalCount: 40, totalPages: 2 } : result;
    });
    render(<Page />);
    let navigation = await screen.findByRole("navigation", { name: "صفحات تعهدات" });
    fireEvent.click(within(navigation).getByRole("button", { name: "بعدی" }));
    await waitFor(() => expect(api).toHaveBeenCalledWith("/admin/settlements/payables?page=2&pageSize=20"));
    fireEvent.click(screen.getByRole("button", { name: "فیلتر و مرتب‌سازی تعهدات" }));
    let dialog = await screen.findByRole("dialog", { name: "فیلتر و مرتب‌سازی تعهدات" });
    fireEvent.change(within(dialog).getByRole("combobox", { name: "وضعیت" }), { target: { value: "Due" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "اعمال" }));
    await waitFor(() => expect(api).toHaveBeenCalledWith("/admin/settlements/payables?page=1&pageSize=20&status=Due"));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    fireEvent.click(within(navigation).getByRole("button", { name: "بعدی" }));
    await waitFor(() => expect(api).toHaveBeenCalledWith("/admin/settlements/payables?page=2&pageSize=20&status=Due"));
    navigation = screen.getByRole("navigation", { name: "صفحات تسویه‌ها" });
    fireEvent.click(within(navigation).getByRole("button", { name: "بعدی" }));
    await waitFor(() => expect(api).toHaveBeenCalledWith("/admin/settlements?page=2&pageSize=20"));
    fireEvent.click(screen.getByRole("button", { name: "فیلتر و مرتب‌سازی تسویه‌ها" }));
    dialog = await screen.findByRole("dialog", { name: "فیلتر و مرتب‌سازی تسویه‌ها" });
    fireEvent.change(within(dialog).getByRole("combobox", { name: "وضعیت" }), { target: { value: "Paid" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "اعمال" }));
    await waitFor(() => expect(api).toHaveBeenCalledWith("/admin/settlements?page=1&pageSize=20&status=Paid"));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    fireEvent.click(within(navigation).getByRole("button", { name: "بعدی" }));
    await waitFor(() => expect(api).toHaveBeenCalledWith("/admin/settlements?page=2&pageSize=20&status=Paid"));
  });

  it.each(["Pending", "Due", "Overdue"])("offers cancellation for %s settlements", async status => {
    const original = api.getMockImplementation()!;
    api.mockImplementation((path: string, options?: RequestInit) => path.startsWith("/admin/settlements?")
      ? Promise.resolve(paged([{ ...batch, status }])) : original(path, options));
    render(<Page />);
    await screen.findByRole("button", { name: "لغو تسویه" });
    expect(screen.getByRole("button", { name: "ثبت تسویه" })).not.toBeNull();
  });

  it.each(["Paid", "Cancelled"])("keeps details but no transition actions for %s", async status => {
    const original = api.getMockImplementation()!;
    api.mockImplementation((path: string, options?: RequestInit) => path.startsWith("/admin/settlements?")
      ? Promise.resolve(paged([{ ...batch, status }])) : original(path, options));
    render(<Page />);
    await screen.findByRole("button", { name: "جزئیات" });
    expect(screen.queryByRole("button", { name: "لغو تسویه" })).toBeNull();
    expect(screen.queryByRole("button", { name: "ثبت تسویه" })).toBeNull();
    if (status === "Cancelled") expect(screen.getByText("لغوشده")).not.toBeNull();
  });

  it("requires a reason, cancels through the Admin endpoint, and refreshes both lists", async () => {
    const original = api.getMockImplementation()!;
    let cancelled = false;
    api.mockImplementation((path: string, options?: RequestInit) => {
      if (path === "/admin/settlements/10/cancel" && options?.method === "POST") {
        cancelled = true;
        return Promise.resolve({ ...batch, status: "Cancelled", cancelledAtUtc: "2026-09-27T12:00:00Z",
          cancellationReason: "اصلاح انتخاب اقلام", items: [] });
      }
      if (path.startsWith("/admin/settlements?")) return Promise.resolve(paged([{ ...batch, status: cancelled ? "Cancelled" : "Due" }]));
      return original(path, options);
    });
    render(<Page />);
    fireEvent.click(await screen.findByRole("button", { name: "لغو تسویه" }));
    const dialog = await screen.findByRole("dialog", { name: "لغو تسویه" });
    const reason = within(dialog).getByRole("textbox", { name: /دلیل لغو/ });
    fireEvent.change(reason, { target: { value: "  " } });
    fireEvent.click(within(dialog).getByRole("button", { name: "تأیید لغو تسویه" }));
    expect(within(dialog).getByText("دلیل لغو تسویه را وارد کنید.")).not.toBeNull();
    expect(reason.getAttribute("aria-invalid")).toBe("true");
    expect(mutations()).toHaveLength(0);
    fireEvent.change(reason, { target: { value: "  اصلاح انتخاب اقلام  " } });
    fireEvent.click(within(dialog).getByRole("button", { name: "تأیید لغو تسویه" }));
    await screen.findByText("لغوشده");
    expect(mutations()).toEqual([["/admin/settlements/10/cancel", {
      method: "POST", body: JSON.stringify({ reason: "اصلاح انتخاب اقلام" }),
    }]]);
    expect(api.mock.calls.filter(([path]) => path === "/admin/settlements?page=1&pageSize=20")).toHaveLength(2);
    expect(api.mock.calls.filter(([path]) => path === "/admin/settlements/payables?page=1&pageSize=20")).toHaveLength(2);
    expect(screen.queryByRole("button", { name: "ثبت تسویه" })).toBeNull();
    expect(screen.queryByRole("button", { name: "لغو تسویه" })).toBeNull();
    expect(screen.getByRole("button", { name: "جزئیات" })).not.toBeNull();
  });

  it("retains the reason and active row when cancellation fails", async () => {
    const original = api.getMockImplementation()!;
    api.mockImplementation((path: string, options?: RequestInit) => path.endsWith("/cancel")
      ? Promise.reject(new Error("Settlement changed concurrently")) : original(path, options));
    render(<Page />);
    fireEvent.click(await screen.findByRole("button", { name: "لغو تسویه" }));
    const dialog = await screen.findByRole("dialog", { name: "لغو تسویه" });
    const reason = within(dialog).getByRole<HTMLTextAreaElement>("textbox", { name: /دلیل لغو/ });
    fireEvent.change(reason, { target: { value: "اصلاح انتخاب" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "تأیید لغو تسویه" }));
    await within(dialog).findByText("Settlement changed concurrently");
    expect(reason.value).toBe("اصلاح انتخاب");
    expect(screen.queryByText("لغوشده")).toBeNull();
  });

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
    expect(within(dialog).queryByText("زمان پرداخت")).toBeNull();
    expect(dialog.querySelector('time[datetime="2026-09-27T00:00:00Z"]')?.children.length).toBe(2);
    expect(dialog.classList.contains("!h-auto")).toBe(true);
    expect(dialog.classList.contains("!max-w-[800px]")).toBe(true);
    const itemsTable = within(dialog).getByRole("table", { name: "اقلام تسویه" });
    expect(itemsTable.parentElement?.parentElement?.classList.contains("overflow-y-auto")).toBe(true);
    expect(itemsTable.parentElement?.parentElement?.classList.contains("max-h-[min(52vh,30rem)]")).toBe(true);
    expect(api).toHaveBeenCalledWith("/admin/settlements/10");
  });

  it("shows the paid timestamp when the persisted settlement is paid", async () => {
    const original = api.getMockImplementation()!;
    api.mockImplementation((path: string, options?: RequestInit) => path === "/admin/settlements/10"
      ? Promise.resolve({ ...batch, status: "Paid", paidAtUtc: "2026-09-28T12:30:00Z", items: [] })
      : original(path, options));
    render(<Page />);
    fireEvent.click(await screen.findByRole("button", { name: "جزئیات" }));
    const dialog = await screen.findByRole("dialog", { name: "جزئیات تسویه" });
    expect(within(dialog).getByText("زمان پرداخت")).not.toBeNull();
    expect(dialog.querySelector('time[datetime="2026-09-28T12:30:00Z"]')).not.toBeNull();
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
