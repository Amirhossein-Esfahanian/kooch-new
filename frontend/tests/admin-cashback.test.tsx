import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AdminGlobalCashbackSettings } from "@/components/admin/AdminGlobalCashbackSettings";
import AdminSiteSettingsPage from "@/app/admin/site-settings/page";
import AdminCashbackPage from "@/app/admin/cashback/page";

const api = vi.hoisted(() => ({ request: vi.fn() }));
const notifications = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn() }));
const navigation = vi.hoisted(() => ({ redirect: vi.fn() }));

vi.mock("@/lib/owner-api", () => ({ apiRequest: api.request, getToken: () => null }));
vi.mock("sonner", () => ({ toast: notifications }));
vi.mock("next/navigation", () => ({ redirect: navigation.redirect }));
vi.mock("@/components/dashboard/DashboardLayouts", () => ({
  AdminLayout: ({ children, requiredPlatformPermission }: {
    children: React.ReactNode; requiredPlatformPermission?: string;
  }) => <div data-required-permission={requiredPlatformPermission}>{children}</div>,
}));
vi.mock("@/components/auth/AuthSessionProvider", () => ({
  useAuthSession: () => ({ authenticated: true, loading: false, workspaces: ["admin"] }),
}));
vi.mock("@/components/SharedUploader", () => ({ SharedUploader: () => <div /> }));

const active = {
  enabled: true, source: "Global", currency: "IRR", calculationMode: "Percentage",
  percentageRate: 10, spendUnitAmount: null, rewardAmount: null,
  maxCashbackPerReservation: 100000, expiryDays: 90,
};
const disabled = {
  enabled: false, source: "Global", currency: "IRR", calculationMode: null,
  percentageRate: null, spendUnitAmount: null, rewardAmount: null,
  maxCashbackPerReservation: null, expiryDays: null,
};

function setup(policy: typeof active | typeof disabled = active) {
  let current = policy;
  api.request.mockImplementation(async (path: string, init?: { method?: string; body?: string }) => {
    if (path === "/admin/cashback/settings?currency=IRR") return current;
    if (path === "/admin/cashback/settings" && init?.method === "PUT") {
      current = { ...current, ...JSON.parse(init.body ?? "{}") };
      return current;
    }
    if (path === "/admin/site-settings") return [{
      id: 1, key: "pricing.currencyLabel", value: "تومان", type: "Text", group: "Pricing",
      label: "واحد پول", description: null, sortOrder: 1, isActive: true,
      createdAtUtc: "2026-01-01T00:00:00Z", updatedAtUtc: null,
    }];
    if (path === "/admin/site-settings/pricing-bounds") return { minPrice: 0, maxPrice: 100000 };
    throw new Error(`Unexpected request: ${path}`);
  });
}

async function load() {
  render(<AdminGlobalCashbackSettings />);
  await waitFor(() => expect((screen.getByRole("switch", { name: "کش‌بک سراسری فعال باشد" }) as HTMLInputElement).disabled).toBe(false));
}
async function openDialog() {
  fireEvent.click(screen.getByRole("button", { name: "تنظیمات" }));
  return screen.findByRole("dialog", { name: "تنظیمات کش‌بک" });
}
function putCalls() {
  return api.request.mock.calls.filter(([path, init]) => path === "/admin/cashback/settings" && init?.method === "PUT");
}

beforeEach(() => {
  api.request.mockReset();
  navigation.redirect.mockReset();
  notifications.success.mockReset();
  notifications.error.mockReset();
  notifications.warning.mockReset();
});

describe("Global Cashback in Admin Site Settings", () => {
  it("renders the compact row in the pricing section under ManageSettings", async () => {
    setup();
    render(<AdminSiteSettingsPage />);
    const row = await screen.findByText("کش‌بک");
    expect(row.closest("#pricing-and-currency")).toBeTruthy();
    expect(document.querySelector('[data-required-permission="ManageSettings"]')).toBeTruthy();
    expect((screen.getByRole("switch", { name: "کش‌بک سراسری فعال باشد" }) as HTMLInputElement).checked).toBe(true);
    expect(api.request).toHaveBeenCalledWith("/admin/cashback/settings?currency=IRR");
    expect(screen.queryByRole("textbox", { name: "کد ارز" })).toBeNull();
  });

  it("disables through the existing API and refetches authoritative state", async () => {
    setup();
    await load();
    fireEvent.click(screen.getByRole("switch", { name: "کش‌بک سراسری فعال باشد" }));
    await waitFor(() => expect(putCalls()).toHaveLength(1));
    expect(JSON.parse(putCalls()[0][1].body)).toEqual({
      currency: "IRR", enabled: false, calculationMode: null, percentageRate: null,
      spendUnitAmount: null, rewardAmount: null, maxCashbackPerReservation: null, expiryDays: null,
    });
    await waitFor(() => expect((screen.getByRole("switch", { name: "کش‌بک سراسری فعال باشد" }) as HTMLInputElement).checked).toBe(false));
    expect(api.request.mock.calls.filter(([path]) => path === "/admin/cashback/settings?currency=IRR")).toHaveLength(2);
  });

  it("keeps enabled appearance and reports a failed disable", async () => {
    setup();
    await load();
    api.request.mockImplementation((_path: string, init?: { method?: string }) =>
      init?.method === "PUT" ? Promise.reject(new Error("Unavailable")) : Promise.resolve(active));
    fireEvent.click(screen.getByRole("switch", { name: "کش‌بک سراسری فعال باشد" }));
    await screen.findByText("Unavailable");
    expect((screen.getByRole("switch", { name: "کش‌بک سراسری فعال باشد" }) as HTMLInputElement).checked).toBe(true);
    expect(notifications.error).toHaveBeenCalled();
  });

  it("opens the editor to enable an unconfigured disabled policy without a premature PUT", async () => {
    setup(disabled);
    await load();
    fireEvent.click(screen.getByRole("switch", { name: "کش‌بک سراسری فعال باشد" }));
    expect(await screen.findByRole("dialog", { name: "تنظیمات کش‌بک" })).toBeTruthy();
    expect(putCalls()).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "بستن" }));
    expect(putCalls()).toHaveLength(0);
  });

  it("validates Percentage and saves the exact enabled policy with internal currency", async () => {
    setup(disabled);
    await load();
    await openDialog();
    expect(screen.getByRole("spinbutton", { name: /درصد کش‌بک/ })).toBeTruthy();
    expect(screen.queryByRole("spinbutton", { name: /مبلغ هر واحد خرید/ })).toBeNull();
    expect(screen.queryByRole("textbox", { name: "کد ارز" })).toBeNull();
    fireEvent.change(screen.getByRole("spinbutton", { name: /درصد کش‌بک/ }), { target: { value: "21" } });
    fireEvent.click(screen.getByRole("button", { name: "ذخیره و فعال‌سازی" }));
    expect(await screen.findByText(/حداکثر ۲۰/)).toBeTruthy();
    expect(putCalls()).toHaveLength(0);
    fireEvent.change(screen.getByRole("spinbutton", { name: /درصد کش‌بک/ }), { target: { value: "10" } });
    fireEvent.change(screen.getByRole("spinbutton", { name: /حداکثر کش‌بک هر رزرو/ }), { target: { value: "100000" } });
    fireEvent.change(screen.getByRole("spinbutton", { name: /مدت اعتبار کش‌بک/ }), { target: { value: "90" } });
    fireEvent.click(screen.getByRole("button", { name: "ذخیره و فعال‌سازی" }));
    await waitFor(() => expect(putCalls()).toHaveLength(1));
    expect(JSON.parse(putCalls()[0][1].body)).toEqual({
      currency: "IRR", enabled: true, calculationMode: "Percentage", percentageRate: 10,
      spendUnitAmount: null, rewardAmount: null, maxCashbackPerReservation: 100000, expiryDays: 90,
    });
    await waitFor(() => expect((screen.getByRole("switch", { name: "کش‌بک سراسری فعال باشد" }) as HTMLInputElement).checked).toBe(true));
  });

  it("shows FixedPerUnit fields without stale Percentage payload", async () => {
    setup();
    await load();
    await openDialog();
    fireEvent.change(screen.getByRole("combobox", { name: /شیوه محاسبه/ }), { target: { value: "FixedPerUnit" } });
    expect(screen.queryByRole("spinbutton", { name: /درصد کش‌بک/ })).toBeNull();
    fireEvent.change(screen.getByRole("spinbutton", { name: /مبلغ هر واحد خرید/ }), { target: { value: "1000000" } });
    fireEvent.change(screen.getByRole("spinbutton", { name: /مبلغ کش‌بک هر واحد/ }), { target: { value: "100000" } });
    fireEvent.click(screen.getByRole("button", { name: "ذخیره تنظیمات" }));
    await waitFor(() => expect(putCalls()).toHaveLength(1));
    expect(JSON.parse(putCalls()[0][1].body)).toMatchObject({
      currency: "IRR", enabled: true, calculationMode: "FixedPerUnit", percentageRate: null,
      spendUnitAmount: 1000000, rewardAmount: 100000,
    });
  });

  it("prevents duplicate save and preserves values on backend error", async () => {
    setup();
    await load();
    await openDialog();
    let reject!: (error: Error) => void;
    api.request.mockImplementation((_path: string, init?: { method?: string }) =>
      init?.method === "PUT" ? new Promise((_, rejectPromise) => { reject = rejectPromise; }) : Promise.resolve(active));
    fireEvent.change(screen.getByRole("spinbutton", { name: /درصد کش‌بک/ }), { target: { value: "12" } });
    fireEvent.click(screen.getByRole("button", { name: "ذخیره تنظیمات" }));
    await waitFor(() => expect((screen.getByRole("button", { name: "ذخیره تنظیمات" }) as HTMLButtonElement).disabled).toBe(true));
    fireEvent.click(screen.getByRole("button", { name: "ذخیره تنظیمات" }));
    expect(putCalls()).toHaveLength(1);
    reject(new Error("Percentage is invalid"));
    await screen.findByText(/درصد یا شیوه محاسبه کش‌بک معتبر نیست/);
    expect((screen.getByRole("spinbutton", { name: /درصد کش‌بک/ }) as HTMLInputElement).value).toBe("12");
  });

  it("loads without stale controls on failure and allows retry", async () => {
    setup();
    api.request.mockRejectedValueOnce(new Error("Unavailable"));
    render(<AdminGlobalCashbackSettings />);
    await screen.findByText(/دریافت تنظیمات کش‌بک انجام نشد/);
    expect((screen.getByRole("switch", { name: "کش‌بک سراسری فعال باشد" }) as HTMLInputElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "تلاش دوباره" }));
    await waitFor(() => expect((screen.getByRole("switch", { name: "کش‌بک سراسری فعال باشد" }) as HTMLInputElement).disabled).toBe(false));
  });

  it("redirects the old standalone route to the pricing section", () => {
    AdminCashbackPage();
    expect(navigation.redirect).toHaveBeenCalledWith("/admin/site-settings#pricing-and-currency");
  });
});
