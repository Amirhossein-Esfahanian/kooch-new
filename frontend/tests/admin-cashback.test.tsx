import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AdminCashbackPage from "@/app/admin/cashback/page";

const api = vi.hoisted(() => ({ request: vi.fn() }));
const notifications = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn() }));

vi.mock("@/lib/owner-api", () => ({ apiRequest: api.request }));
vi.mock("sonner", () => ({ toast: notifications }));
vi.mock("@/components/dashboard/DashboardLayouts", () => ({
  AdminLayout: ({ children, requiredPlatformPermission }: {
    children: React.ReactNode; requiredPlatformPermission?: string;
  }) => <div data-required-permission={requiredPlatformPermission}>{children}</div>,
}));

const percentagePolicy = {
  enabled: true, source: "Global", currency: "IRR", calculationMode: "Percentage",
  percentageRate: 10, spendUnitAmount: null, rewardAmount: null,
  maxCashbackPerReservation: 100000, expiryDays: 90,
};
const disabledPolicy = {
  enabled: false, source: "Global", currency: "IRR", calculationMode: null,
  percentageRate: null, spendUnitAmount: null, rewardAmount: null,
  maxCashbackPerReservation: null, expiryDays: null,
};

type TestPolicy = {
  enabled: boolean; source: string; currency: string; calculationMode: string | null;
  percentageRate: number | null; spendUnitAmount: number | null; rewardAmount: number | null;
  maxCashbackPerReservation: number | null; expiryDays: number | null;
};

function mockPolicy(policy: TestPolicy = percentagePolicy) {
  api.request.mockImplementation(async (path: string) => {
    if (path === "/admin/cashback/settings?currency=IRR") return policy;
    if (path === "/admin/cashback/settings") return policy;
    throw new Error(`Unexpected request: ${path}`);
  });
}

async function load() {
  render(<AdminCashbackPage />);
  await screen.findByRole("switch", { name: "کش‌بک سراسری فعال باشد" });
}

beforeEach(() => {
  api.request.mockReset();
  notifications.success.mockReset();
  notifications.error.mockReset();
  notifications.warning.mockReset();
});

describe("Admin global Cashback settings", () => {
  it("uses the ManageSettings page guard and loads the authoritative IRR policy", async () => {
    mockPolicy();
    await load();
    expect(document.querySelector('[data-required-permission="ManageSettings"]')).toBeTruthy();
    expect(api.request).toHaveBeenCalledWith("/admin/cashback/settings?currency=IRR");
    expect((screen.getByRole("switch", { name: "کش‌بک سراسری فعال باشد" }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole("spinbutton", { name: /درصد کش‌بک/ }) as HTMLInputElement).value).toBe("10");
    expect(screen.getByText(/مثلاً 10 یعنی 10٪/)).toBeTruthy();
    expect(screen.queryByRole("spinbutton", { name: /به‌ازای هر مبلغ/ })).toBeNull();
    expect((screen.getByRole("spinbutton", { name: /حداکثر کش‌بک هر رزرو/ }) as HTMLInputElement).value).toBe("100000");
    expect((screen.getByRole("spinbutton", { name: /مدت اعتبار کش‌بک/ }) as HTMLInputElement).value).toBe("90");
    expect(screen.getByText(/از زمان اضافه‌شدن واقعی کش‌بک به کیف پول/)).toBeTruthy();
  });

  it("changes currency without showing the prior policy during load or after a failure", async () => {
    mockPolicy();
    await load();
    api.request.mockImplementation(async (path: string) => {
      if (path === "/admin/cashback/settings?currency=USD") throw new Error("Unavailable");
      return percentagePolicy;
    });
    fireEvent.change(screen.getByRole("textbox", { name: "کد ارز" }), { target: { value: "USD" } });
    await waitFor(() => expect(api.request).toHaveBeenCalledWith("/admin/cashback/settings?currency=USD"));
    await screen.findByText(/دریافت تنظیمات این ارز انجام نشد/);
    expect(screen.queryByRole("switch", { name: "کش‌بک سراسری فعال باشد" })).toBeNull();
    expect(screen.queryByRole("spinbutton", { name: /درصد کش‌بک/ })).toBeNull();
    expect(screen.getByRole("button", { name: "تلاش دوباره" })).toBeTruthy();
  });

  it("keeps the prior currency hidden while the new currency request is pending, then retries", async () => {
    mockPolicy();
    await load();
    let rejectLoad!: (error: Error) => void;
    const pending = new Promise((_, reject) => { rejectLoad = reject; });
    api.request.mockImplementation((path: string) => path === "/admin/cashback/settings?currency=USD"
      ? pending : Promise.resolve(percentagePolicy));
    fireEvent.change(screen.getByRole("textbox", { name: "کد ارز" }), { target: { value: "USD" } });
    expect(screen.queryByRole("spinbutton", { name: /درصد کش‌بک/ })).toBeNull();
    rejectLoad(new Error("Unavailable"));
    await screen.findByRole("button", { name: "تلاش دوباره" });
    api.request.mockImplementation((path: string) => path === "/admin/cashback/settings?currency=USD"
      ? Promise.resolve({ ...disabledPolicy, currency: "USD" }) : Promise.resolve(percentagePolicy));
    fireEvent.click(screen.getByRole("button", { name: "تلاش دوباره" }));
    await waitFor(() => expect((screen.getByRole("switch", { name: "کش‌بک سراسری فعال باشد" }) as HTMLInputElement).checked).toBe(false));
  });

  it("loads another currency and resets every form value from its response", async () => {
    mockPolicy();
    await load();
    api.request.mockImplementation(async (path: string) => {
      if (path === "/admin/cashback/settings?currency=USD") return {
        ...disabledPolicy, currency: "USD",
      };
      return percentagePolicy;
    });
    fireEvent.change(screen.getByRole("textbox", { name: "کد ارز" }), { target: { value: "USD" } });
    await waitFor(() => expect((screen.getByRole("switch", { name: "کش‌بک سراسری فعال باشد" }) as HTMLInputElement).checked).toBe(false));
    expect(screen.queryByRole("spinbutton", { name: /درصد کش‌بک/ })).toBeNull();
  });

  it("displays a backend FixedPerUnit policy in the selected mode and its fields", async () => {
    mockPolicy({ ...percentagePolicy, calculationMode: "FixedPerUnit",
      percentageRate: null, spendUnitAmount: 1000000, rewardAmount: 100000 });
    await load();
    expect((screen.getByRole("combobox", { name: /شیوه محاسبه/ }) as HTMLSelectElement).value).toBe("FixedPerUnit");
    expect((screen.getByRole("spinbutton", { name: /به‌ازای هر مبلغ/ }) as HTMLInputElement).value).toBe("1000000");
    expect((screen.getByRole("spinbutton", { name: /مقدار کش‌بک/ }) as HTMLInputElement).value).toBe("100000");
    expect(screen.queryByRole("spinbutton", { name: /درصد کش‌بک/ })).toBeNull();
  });

  it("renders disabled policy and saves it without fabricated financial values", async () => {
    mockPolicy(disabledPolicy);
    await load();
    expect((screen.getByRole("switch", { name: "کش‌بک سراسری فعال باشد" }) as HTMLInputElement).checked).toBe(false);
    expect(screen.queryByRole("spinbutton", { name: /درصد کش‌بک/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "ذخیره تنظیمات" }));
    await waitFor(() => expect(api.request).toHaveBeenCalledWith("/admin/cashback/settings", {
      method: "PUT",
      body: JSON.stringify({ currency: "IRR", enabled: false, calculationMode: null,
        percentageRate: null, spendUnitAmount: null, rewardAmount: null,
        maxCashbackPerReservation: null, expiryDays: null }),
    }));
  });

  it("enables Percentage policy and sends only the exact global DTO fields", async () => {
    mockPolicy(disabledPolicy);
    await load();
    fireEvent.click(screen.getByRole("switch", { name: "کش‌بک سراسری فعال باشد" }));
    fireEvent.change(screen.getByRole("spinbutton", { name: /درصد کش‌بک/ }), { target: { value: "10" } });
    fireEvent.change(screen.getByRole("spinbutton", { name: /حداکثر کش‌بک هر رزرو/ }), { target: { value: "100000" } });
    fireEvent.change(screen.getByRole("spinbutton", { name: /مدت اعتبار کش‌بک/ }), { target: { value: "90" } });
    fireEvent.click(screen.getByRole("button", { name: "ذخیره تنظیمات" }));
    await waitFor(() => expect(api.request).toHaveBeenCalledWith("/admin/cashback/settings", {
      method: "PUT",
      body: JSON.stringify({ currency: "IRR", enabled: true, calculationMode: "Percentage",
        percentageRate: 10, spendUnitAmount: null, rewardAmount: null,
        maxCashbackPerReservation: 100000, expiryDays: 90 }),
    }));
  });

  it.each(["0", "21"])("rejects Percentage %s before PUT", async (rate) => {
    mockPolicy();
    await load();
    fireEvent.change(screen.getByRole("spinbutton", { name: /درصد کش‌بک/ }), { target: { value: rate } });
    fireEvent.click(screen.getByRole("button", { name: "ذخیره تنظیمات" }));
    expect(await screen.findByText(/بیشتر از صفر و حداکثر ۲۰/)).toBeTruthy();
    expect(api.request.mock.calls.some(([path, init]) =>
      path === "/admin/cashback/settings" && init?.method === "PUT")).toBe(false);
  });

  it("rejects non-positive cap and expiry without calling PUT", async () => {
    mockPolicy();
    await load();
    fireEvent.change(screen.getByRole("spinbutton", { name: /حداکثر کش‌بک هر رزرو/ }), { target: { value: "0" } });
    fireEvent.change(screen.getByRole("spinbutton", { name: /مدت اعتبار کش‌بک/ }), { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: "ذخیره تنظیمات" }));
    expect(await screen.findByText(/حداکثر کش‌بک باید مبلغی بیشتر از صفر/)).toBeTruthy();
    expect(screen.getByText(/مدت اعتبار باید تعداد روز صحیح/)).toBeTruthy();
    expect(api.request.mock.calls.some(([path, init]) =>
      path === "/admin/cashback/settings" && init?.method === "PUT")).toBe(false);
  });

  it("shows fixed-per-unit fields and clears the inactive Percentage payload", async () => {
    mockPolicy();
    await load();
    fireEvent.change(screen.getByRole("combobox", { name: /شیوه محاسبه/ }), { target: { value: "FixedPerUnit" } });
    expect(screen.queryByRole("spinbutton", { name: /درصد کش‌بک/ })).toBeNull();
    fireEvent.change(screen.getByRole("spinbutton", { name: /به‌ازای هر مبلغ/ }), { target: { value: "1000000" } });
    fireEvent.change(screen.getByRole("spinbutton", { name: /مقدار کش‌بک/ }), { target: { value: "100000" } });
    fireEvent.click(screen.getByRole("button", { name: "ذخیره تنظیمات" }));
    await waitFor(() => {
      const put = api.request.mock.calls.find(([path, init]) =>
        path === "/admin/cashback/settings" && init?.method === "PUT");
      expect(JSON.parse(put?.[1]?.body as string)).toMatchObject({
        calculationMode: "FixedPerUnit", percentageRate: null,
        spendUnitAmount: 1000000, rewardAmount: 100000,
      });
    });
  });

  it("refetches after save and shows the authoritative response", async () => {
    let getCount = 0;
    api.request.mockImplementation(async (path: string) => {
      if (path === "/admin/cashback/settings?currency=IRR") {
        getCount++;
        return getCount === 1 ? percentagePolicy : { ...percentagePolicy, percentageRate: 12 };
      }
      if (path === "/admin/cashback/settings") return percentagePolicy;
      throw new Error(path);
    });
    await load();
    fireEvent.click(screen.getByRole("button", { name: "ذخیره تنظیمات" }));
    await waitFor(() => expect((screen.getByRole("spinbutton", { name: /درصد کش‌بک/ }) as HTMLInputElement).value).toBe("12"));
    expect(getCount).toBe(2);
    expect(notifications.success).toHaveBeenCalled();
  });

  it("keeps form values on backend validation failure and blocks duplicate submits", async () => {
    mockPolicy();
    await load();
    let rejectPut!: (error: Error) => void;
    const pending = new Promise((_, reject) => { rejectPut = reject; });
    api.request.mockImplementation((path: string) => path === "/admin/cashback/settings"
      ? pending : Promise.resolve(percentagePolicy));
    fireEvent.change(screen.getByRole("spinbutton", { name: /درصد کش‌بک/ }), { target: { value: "12" } });
    fireEvent.click(screen.getByRole("button", { name: "ذخیره تنظیمات" }));
    await waitFor(() => expect((screen.getByRole("button", { name: "ذخیره تنظیمات" }) as HTMLButtonElement).disabled).toBe(true));
    fireEvent.click(screen.getByRole("button", { name: "ذخیره تنظیمات" }));
    expect(api.request.mock.calls.filter(([path, init]) =>
      path === "/admin/cashback/settings" && init?.method === "PUT")).toHaveLength(1);
    rejectPut(new Error("Percentage is invalid"));
    expect(await screen.findByText(/درصد یا شیوه محاسبه کش‌بک معتبر نیست/)).toBeTruthy();
    expect((screen.getByRole("spinbutton", { name: /درصد کش‌بک/ }) as HTMLInputElement).value).toBe("12");
    expect(notifications.success).not.toHaveBeenCalled();
  });

  it("explains non-withdrawable credit and separate Commission without Property override calls", async () => {
    mockPolicy();
    await load();
    expect(screen.getByText(/اعتبار آن قابل برداشت نیست/)).toBeTruthy();
    expect(screen.getByText(/به‌طور خودکار کمیسیون اقامتگاه را/)).toBeTruthy();
    expect(api.request.mock.calls.some(([path]) => String(path).includes("/admin/properties/"))).toBe(false);
  });
});
