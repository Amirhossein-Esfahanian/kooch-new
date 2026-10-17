import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  request: vi.fn(),
  success: vi.fn(),
  session: { platformRole: "SuperAdmin", platformPermissions: [] as string[] },
}));

vi.mock("@/lib/owner-api", () => ({ apiRequest: mocks.request }));
vi.mock("@/lib/currency", () => ({
  useSiteCurrencyLabel: () => "تومان",
  formatCurrency: (value: number, options: { currencyLabel: string }) => `${value.toLocaleString("fa-IR")} ${options.currencyLabel}`,
}));
vi.mock("sonner", () => ({ toast: { success: mocks.success } }));
vi.mock("@/components/auth/AuthSessionProvider", () => ({
  useAuthSession: () => mocks.session,
}));
vi.mock("@/components/promotions/PromotionWorkspace", () => ({
  PromotionWorkspace: () => <div>فهرست پروموشن‌ها</div>,
}));
vi.mock("@/components/dashboard/DashboardLayouts", () => ({
  AdminLayout: ({ children, requiredPlatformPermission }: { children: React.ReactNode; requiredPlatformPermission: string }) => <div data-permission={requiredPlatformPermission}>{children}</div>,
}));
vi.mock("@/components/KoochDatePicker", () => ({
  KoochDatePicker: ({ onChange, labels }: { onChange: (value: { startDate: string; endDate: string }) => void; labels: { start: string; end: string; rangeTitle: string } }) =>
    <button type="button" data-start-label={labels.start} data-end-label={labels.end} data-range-title={labels.rangeTitle} onClick={() => onChange({ startDate: "2026-10-18", endDate: "2026-10-20" })}>انتخاب بازه</button>,
}));
vi.mock("@/components/KoochDialog", () => ({
  KoochDialog: ({ children, open, title }: { children: React.ReactNode; open: boolean; title: string }) => open ? <div role="dialog" aria-label={title}>{children}</div> : null,
}));
vi.mock("@/components/KoochConfirmDialog", () => ({
  KoochConfirmDialog: ({ open, onConfirm }: { open: boolean; onConfirm: () => void }) => open ? <button onClick={onConfirm}>تأیید حذف</button> : null,
}));

import AdminWelcomeGiftsPage from "@/app/admin/welcome-gifts/page";
import AdminPromotionsPage from "@/app/admin/promotions/page";

const campaign = {
  id: 7, title: "هدیه پاییز", amount: 100000, startDate: "2026-10-15",
  endDate: "2026-10-25", maxRecipients: 10, grantedCount: 3,
  validityDays: 30, isActive: true,
};

describe("Admin Welcome Gift campaigns", () => {
  beforeEach(() => {
    mocks.request.mockReset();
    mocks.success.mockReset();
    mocks.session.platformRole = "SuperAdmin";
    mocks.session.platformPermissions = [];
    mocks.request.mockImplementation(async (path: string) => {
      if (path === "/admin/welcome-gift-campaigns") return [campaign];
      throw new Error(`Unexpected request: ${path}`);
    });
  });

  it("uses ManagePromotions and shows the campaign details without a currency field", async () => {
    const { container } = render(<AdminWelcomeGiftsPage />);
    expect(container.querySelector('[data-permission="ManagePromotions"]')).toBeTruthy();
    expect(await screen.findByText("هدیه پاییز")).toBeTruthy();
    expect(screen.getByText("۱۰۰٬۰۰۰ تومان")).toBeTruthy();
    expect(screen.getByText("۳۰ روز")).toBeTruthy();
    expect(screen.getByText("۳ / ۱۰")).toBeTruthy();
    expect(screen.getByText("فعال")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "ایجاد کمپین" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByLabelText(/مبلغ \(تومان\)/)).toBeTruthy();
    expect(within(dialog).queryByLabelText("ارز")).toBeNull();
    const dateControl = within(dialog).getByRole("button", { name: "انتخاب بازه" });
    expect(dateControl.getAttribute("data-start-label")).toBe("تاریخ شروع");
    expect(dateControl.getAttribute("data-end-label")).toBe("تاریخ پایان");
    expect(dateControl.getAttribute("data-range-title")).toBe("بازه اجرای کمپین");
    expect(within(dialog).getByLabelText(/عنوان/).closest(".grid")?.className).toContain("[&>label]:font-medium");
  });

  it("links from Promotions only for ManagePromotions users", () => {
    const { rerender } = render(<AdminPromotionsPage />);
    expect(screen.getByRole("link", { name: /هدیه خوش‌آمدگویی/ }).getAttribute("href")).toBe("/admin/welcome-gifts");

    mocks.session.platformRole = "AdminAssistant";
    mocks.session.platformPermissions = [];
    rerender(<AdminPromotionsPage />);
    expect(screen.queryByRole("link", { name: /هدیه خوش‌آمدگویی/ })).toBeNull();

    mocks.session.platformPermissions = ["ManagePromotions"];
    rerender(<AdminPromotionsPage />);
    expect(screen.getByRole("link", { name: /هدیه خوش‌آمدگویی/ })).toBeTruthy();
  });

  it("creates with backend field names and displays overlap errors without closing", async () => {
    mocks.request.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === "/admin/welcome-gift-campaigns" && init?.method === "POST") throw new Error("بازه کمپین‌ها همپوشانی دارد");
      return [];
    });
    render(<AdminWelcomeGiftsPage />);
    fireEvent.click(screen.getByRole("button", { name: "ایجاد کمپین" }));
    fireEvent.change(screen.getByLabelText(/عنوان/), { target: { value: "هدیه جدید" } });
    fireEvent.change(screen.getByLabelText(/مبلغ \(تومان\)/), { target: { value: "200000" } });
    fireEvent.click(screen.getByRole("button", { name: "انتخاب بازه" }));
    fireEvent.change(screen.getByLabelText(/حداکثر دریافت‌کنندگان/), { target: { value: "50" } });
    fireEvent.change(screen.getByLabelText(/مدت اعتبار \(روز\)/), { target: { value: "90" } });
    fireEvent.click(screen.getByRole("button", { name: "ذخیره" }));
    await waitFor(() => expect(screen.getByText("بازه کمپین‌ها همپوشانی دارد")).toBeTruthy());
    expect(mocks.request).toHaveBeenCalledWith("/admin/welcome-gift-campaigns", {
      method: "POST",
      body: JSON.stringify({ title: "هدیه جدید", amount: 200000, startDate: "2026-10-18", endDate: "2026-10-20", maxRecipients: 50, validityDays: 90, isActive: true }),
    });
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("edits existing campaign values and refetches after save", async () => {
    mocks.request.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === "/admin/welcome-gift-campaigns/7" && init?.method === "PUT") return campaign;
      if (path === "/admin/welcome-gift-campaigns") return [campaign];
      throw new Error(`Unexpected request: ${path}`);
    });
    render(<AdminWelcomeGiftsPage />);
    fireEvent.click(await screen.findByRole("button", { name: "ویرایش هدیه پاییز" }));
    expect((screen.getByLabelText(/عنوان/) as HTMLInputElement).value).toBe("هدیه پاییز");
    expect((screen.getByLabelText(/مدت اعتبار \(روز\)/) as HTMLInputElement).value).toBe("30");
    fireEvent.click(screen.getByRole("button", { name: "ذخیره" }));
    await waitFor(() => expect(mocks.request).toHaveBeenCalledWith("/admin/welcome-gift-campaigns/7", expect.objectContaining({ method: "PUT" })));
    await waitFor(() => expect(mocks.request.mock.calls.filter(([path]) => path === "/admin/welcome-gift-campaigns").length).toBe(2));
  });

  it("shows the backend deletion rejection", async () => {
    mocks.request.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === "/admin/welcome-gift-campaigns/7" && init?.method === "DELETE") throw new Error("کمپین دارای هدیه ثبت‌شده است");
      if (path === "/admin/welcome-gift-campaigns") return [campaign];
      throw new Error(`Unexpected request: ${path}`);
    });
    render(<AdminWelcomeGiftsPage />);
    fireEvent.click(await screen.findByRole("button", { name: "حذف هدیه پاییز" }));
    fireEvent.click(screen.getByRole("button", { name: "تأیید حذف" }));
    expect(await screen.findByText("کمپین دارای هدیه ثبت‌شده است")).toBeTruthy();
  });

  it("distinguishes future, capacity reached, inactive, and ended campaigns", async () => {
    mocks.request.mockResolvedValue([
      { ...campaign, id: 1, title: "آینده", startDate: "9999-01-01", endDate: "9999-12-31" },
      { ...campaign, id: 2, title: "تکمیل", grantedCount: 10 },
      { ...campaign, id: 3, title: "خاموش", isActive: false },
      { ...campaign, id: 4, title: "گذشته", endDate: "2000-01-01" },
    ]);
    render(<AdminWelcomeGiftsPage />);
    expect(await screen.findByRole("heading", { name: "آینده" })).toBeTruthy();
    expect(screen.getByText("ظرفیت تکمیل")).toBeTruthy();
    expect(screen.getByText("غیرفعال")).toBeTruthy();
    expect(screen.getByText("پایان‌یافته")).toBeTruthy();
  });

  it("deletes through the existing campaign endpoint and reloads", async () => {
    mocks.request.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === "/admin/welcome-gift-campaigns/7" && init?.method === "DELETE") return undefined;
      if (path === "/admin/welcome-gift-campaigns") return [campaign];
      throw new Error(`Unexpected request: ${path}`);
    });
    render(<AdminWelcomeGiftsPage />);
    fireEvent.click(await screen.findByRole("button", { name: "حذف هدیه پاییز" }));
    fireEvent.click(screen.getByRole("button", { name: "تأیید حذف" }));
    await waitFor(() => expect(mocks.request).toHaveBeenCalledWith("/admin/welcome-gift-campaigns/7", { method: "DELETE" }));
    await waitFor(() => expect(mocks.request.mock.calls.filter(([path]) => path === "/admin/welcome-gift-campaigns").length).toBe(2));
  });
});
