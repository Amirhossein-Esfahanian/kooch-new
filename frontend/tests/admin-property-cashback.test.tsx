import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AdminPropertyEditPage from "@/app/admin/properties/[id]/page";
import OwnerPropertyEditPage from "@/app/owner/properties/[id]/page";
import { PropertyCashbackSettings } from "@/components/admin/PropertyCashbackSettings";

const api = vi.hoisted(() => ({ request: vi.fn() }));
const session = vi.hoisted(() => ({
  current: { loading: false, authenticated: true, workspaces: ["admin"],
    platformRole: "AdminAssistant", platformPermissions: ["ManageSettings"] },
}));
const notifications = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn() }));

vi.mock("@/lib/owner-api", () => ({ apiRequest: api.request }));
vi.mock("@/components/auth/AuthSessionProvider", () => ({ useAuthSession: () => session.current }));
vi.mock("next/navigation", () => ({ useParams: () => ({ id: "17" }) }));
vi.mock("@/components/admin/AdminPropertyPanel", () => ({
  AdminPropertyPanel: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/dashboard/DashboardLayouts", () => ({
  OwnerLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/owner/PropertyWizard", () => ({
  PropertyWizard: ({ adminCashbackSettings }: { adminCashbackSettings?: React.ReactNode }) => <div>
    <section aria-label="موقعیت">موقعیت</section>
    <section aria-label="قوانین و زمان‌ها">
      <h2>قوانین و زمان‌ها</h2>
      {adminCashbackSettings}
    </section>
  </div>,
}));
vi.mock("sonner", () => ({ toast: notifications }));

type TestResponse = {
  state: "Inherit" | "EnabledOverride" | "Disabled";
  effectivePolicy: {
    enabled: boolean; source: "Global" | "PropertyOverride" | "PropertyDisabled";
    currency: string; calculationMode: "Percentage" | "FixedPerUnit" | null;
    percentageRate: number | null; spendUnitAmount: number | null; rewardAmount: number | null;
    maxCashbackPerReservation: number | null; expiryDays: number | null;
  };
};
const policy: TestResponse["effectivePolicy"] = {
  enabled: true, source: "PropertyOverride", currency: "IRR", calculationMode: "Percentage",
  percentageRate: 10, spendUnitAmount: null, rewardAmount: null,
  maxCashbackPerReservation: 100000, expiryDays: 90,
};
const override: TestResponse = { state: "EnabledOverride", effectivePolicy: policy };
const inherited: TestResponse = { state: "Inherit", effectivePolicy: { ...policy, source: "Global" } };
const disabled: TestResponse = { state: "Disabled", effectivePolicy: {
  ...policy, enabled: false, source: "PropertyDisabled", calculationMode: null,
  percentageRate: null, maxCashbackPerReservation: null, expiryDays: null,
} };

const path = "/admin/properties/17/cashback";
function mockResponse(response: TestResponse = override) {
  api.request.mockImplementation(async (url: string) => {
    if (url === `${path}?currency=IRR` || url === path) return response;
    throw new Error(`Unexpected request: ${url}`);
  });
}
async function load(response: TestResponse = override) {
  mockResponse(response);
  render(<PropertyCashbackSettings propertyId={17} />);
  await screen.findByText(`وضعیت: ${response.state === "Inherit" ? "استفاده از تنظیمات سراسری" : response.state === "Disabled" ? "کش‌بک برای این اقامتگاه غیرفعال" : "تنظیم اختصاصی فعال"}`);
  fireEvent.click(screen.getByRole("button", { name: "تنظیمات" }));
  await screen.findByRole("combobox", { name: /رفتار کش‌بک/ });
}
function put() {
  return api.request.mock.calls.find(([url, init]) => url === path && init?.method === "PUT");
}
function save() {
  fireEvent.click(screen.getByRole("button", { name: "ذخیره تنظیمات کش‌بک" }));
}
function state(value: string) {
  fireEvent.change(screen.getByRole("combobox", { name: /رفتار کش‌بک/ }), { target: { value } });
}
function input(name: RegExp, value: string) {
  fireEvent.change(screen.getByRole("spinbutton", { name }), { target: { value } });
}

beforeEach(() => {
  api.request.mockReset();
  Object.values(notifications).forEach((fn) => fn.mockReset());
  session.current = { loading: false, authenticated: true, workspaces: ["admin"],
    platformRole: "AdminAssistant", platformPermissions: ["ManageSettings"] };
});

describe("Admin Property Cashback override", () => {
  it("loads only for an authorized Admin on the existing property edit page", async () => {
    mockResponse(inherited);
    render(<AdminPropertyEditPage />);
    await screen.findByRole("heading", { name: "کش‌بک این اقامتگاه" });
    expect(within(screen.getByRole("region", { name: "قوانین و زمان‌ها" })).getByText("وضعیت: استفاده از تنظیمات سراسری")).toBeTruthy();
    expect(within(screen.getByRole("region", { name: "موقعیت" })).queryByText(/کش‌بک/)).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "تنظیمات" }));
    expect(await screen.findByRole("dialog", { name: "تنظیمات کش‌بک اقامتگاه" })).toBeTruthy();
    expect(api.request).toHaveBeenCalledWith(`${path}?currency=IRR`);
  });

  it("allows SuperAdmin through the established Admin workspace permission convention", async () => {
    session.current = { ...session.current, platformRole: "SuperAdmin", platformPermissions: [] };
    mockResponse(inherited);
    render(<AdminPropertyEditPage />);
    await screen.findByRole("heading", { name: "کش‌بک این اقامتگاه" });
    expect(api.request).toHaveBeenCalledWith(`${path}?currency=IRR`);
  });

  it.each([
    ["AdminAssistant", [], ["admin"]], ["Client", ["ManageSettings"], []],
  ])("does not load for %s with permissions %j", async (platformRole, platformPermissions, workspaces) => {
    session.current = { ...session.current, platformRole, platformPermissions, workspaces };
    render(<AdminPropertyEditPage />);
    expect(screen.queryByRole("heading", { name: "کش‌بک این اقامتگاه" })).toBeNull();
    expect(api.request).not.toHaveBeenCalled();
  });

  it("does not pass Cashback UI or issue its request from the Owner edit route", () => {
    render(<OwnerPropertyEditPage />);
    expect(screen.queryByRole("heading", { name: "کش‌بک این اقامتگاه" })).toBeNull();
    expect(screen.queryByRole("dialog", { name: "تنظیمات کش‌بک اقامتگاه" })).toBeNull();
    expect(api.request.mock.calls.some(([url]) => String(url).includes("/cashback"))).toBe(false);
  });

  it("distinguishes inherited global policy from explicit disabled state", async () => {
    await load(inherited);
    expect((screen.getByRole("combobox", { name: /رفتار کش‌بک/ }) as HTMLSelectElement).value).toBe("Inherit");
    expect(screen.getByText(/از سیاست سراسری همین ارز پیروی می‌کند/)).toBeTruthy();
    expect(screen.queryByRole("spinbutton", { name: /درصد کش‌بک/ })).toBeNull();
    state("Disabled");
    expect(screen.getByText(/صراحتاً غیرفعال است/)).toBeTruthy();
  });

  it.each(["Inherit", "Disabled"])("clears every financial field when switching override to %s", async (next) => {
    await load();
    state(next);
    save();
    await waitFor(() => expect(put()).toBeTruthy());
    expect(JSON.parse(put()?.[1].body)).toEqual({
      currency: "IRR", state: next, calculationMode: null, percentageRate: null,
      spendUnitAmount: null, rewardAmount: null, maxCashbackPerReservation: null, expiryDays: null,
    });
    expect(api.request.mock.calls.some(([url]) => url === "/admin/cashback/settings")).toBe(false);
  });

  it("loads a disabled response without pretending that it inherits Global", async () => {
    await load(disabled);
    expect((screen.getByRole("combobox", { name: /رفتار کش‌بک/ }) as HTMLSelectElement).value).toBe("Disabled");
    expect(screen.getByText(/حتی اگر سیاست سراسری فعال باشد/)).toBeTruthy();
    expect(screen.queryByRole("spinbutton", { name: /حداکثر کش‌بک/ })).toBeNull();
  });

  it("populates Percentage override and uses 10 as 10 percent", async () => {
    await load();
    expect((screen.getByRole("spinbutton", { name: /درصد کش‌بک/ }) as HTMLInputElement).value).toBe("10");
    expect(screen.getByText(/10 یعنی 10٪/)).toBeTruthy();
    expect(screen.queryByRole("spinbutton", { name: /به‌ازای هر مبلغ/ })).toBeNull();
    expect((screen.getByRole("spinbutton", { name: /حداکثر کش‌بک/ }) as HTMLInputElement).value).toBe("100000");
    expect((screen.getByRole("spinbutton", { name: /مدت اعتبار/ }) as HTMLInputElement).value).toBe("90");
    expect(screen.getByText(/از زمان اضافه‌شدن واقعی کش‌بک به کیف پول/)).toBeTruthy();
    expect(screen.getByText(/کمیسیون آن را به‌طور خودکار تغییر نمی‌دهد/)).toBeTruthy();
  });

  it.each(["0", "21"])("rejects invalid Percentage %s", async (rate) => {
    await load();
    input(/درصد کش‌بک/, rate);
    save();
    expect(await screen.findByText(/بیشتر از صفر و حداکثر ۲۰/)).toBeTruthy();
    expect(put()).toBeUndefined();
  });

  it("rejects nonpositive cap and expiry in override mode", async () => {
    await load();
    input(/حداکثر کش‌بک/, "0");
    input(/مدت اعتبار/, "0");
    save();
    expect(await screen.findByText(/حداکثر کش‌بک باید بیشتر از صفر/)).toBeTruthy();
    expect(screen.getByText(/مدت اعتبار باید تعداد روز صحیح/)).toBeTruthy();
    expect(put()).toBeUndefined();
  });

  it("submits exactly the active Percentage fields and refetches authoritative values", async () => {
    let gets = 0;
    api.request.mockImplementation(async (url: string) => {
      if (url === `${path}?currency=IRR`) return ++gets === 1 ? override :
        { ...override, effectivePolicy: { ...policy, percentageRate: 12 } };
      if (url === path) return override;
      throw new Error(url);
    });
    render(<PropertyCashbackSettings propertyId={17} />);
    await screen.findByText("وضعیت: تنظیم اختصاصی فعال");
    fireEvent.click(screen.getByRole("button", { name: "تنظیمات" }));
    await screen.findByRole("spinbutton", { name: /درصد کش‌بک/ });
    save();
    await waitFor(() => expect(gets).toBe(2));
    expect(JSON.parse(put()?.[1].body)).toEqual({
      currency: "IRR", state: "EnabledOverride", calculationMode: "Percentage",
      percentageRate: 10, spendUnitAmount: null, rewardAmount: null,
      maxCashbackPerReservation: 100000, expiryDays: 90,
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "تنظیمات" }));
    expect((await screen.findByRole("spinbutton", { name: /درصد کش‌بک/ }) as HTMLInputElement).value).toBe("12");
  });

  it("closes the editor and offers retry when a saved policy cannot be refetched", async () => {
    let gets = 0;
    api.request.mockImplementation(async (url: string) => {
      if (url === `${path}?currency=IRR`) {
        if (++gets === 1) return override;
        throw new Error("Unavailable");
      }
      if (url === path) return override;
      throw new Error(url);
    });
    render(<PropertyCashbackSettings propertyId={17} />);
    await screen.findByText("وضعیت: تنظیم اختصاصی فعال");
    fireEvent.click(screen.getByRole("button", { name: "تنظیمات" }));
    await screen.findByRole("spinbutton", { name: /درصد کش‌بک/ });
    save();
    await waitFor(() => expect(notifications.warning).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getByRole("button", { name: "تلاش دوباره" })).toBeTruthy();
    expect(screen.queryByText("وضعیت: تنظیم اختصاصی فعال")).toBeNull();
  });

  it("switches to FixedPerUnit and omits the stale Percentage field", async () => {
    await load();
    fireEvent.change(screen.getByRole("combobox", { name: /شیوه محاسبه/ }),
      { target: { value: "FixedPerUnit" } });
    expect(screen.queryByRole("spinbutton", { name: /درصد کش‌بک/ })).toBeNull();
    input(/مبلغ هر واحد خرید/, "1000000");
    input(/مبلغ کش‌بک هر واحد/, "100000");
    save();
    await waitFor(() => expect(put()).toBeTruthy());
    expect(JSON.parse(put()?.[1].body)).toEqual({
      currency: "IRR", state: "EnabledOverride", calculationMode: "FixedPerUnit",
      percentageRate: null, spendUnitAmount: 1000000, rewardAmount: 100000,
      maxCashbackPerReservation: 100000, expiryDays: 90,
    });
  });

  it("switches back to Percentage and omits stale fixed amounts", async () => {
    await load();
    const mode = screen.getByRole("combobox", { name: /شیوه محاسبه/ });
    fireEvent.change(mode, { target: { value: "FixedPerUnit" } });
    input(/مبلغ هر واحد خرید/, "1000000");
    input(/مبلغ کش‌بک هر واحد/, "100000");
    fireEvent.change(mode, { target: { value: "Percentage" } });
    input(/درصد کش‌بک/, "12");
    save();
    await waitFor(() => expect(put()).toBeTruthy());
    expect(JSON.parse(put()?.[1].body)).toMatchObject({
      calculationMode: "Percentage", percentageRate: 12,
      spendUnitAmount: null, rewardAmount: null,
    });
  });

  it("keeps IRR internal without an editable currency field", async () => {
    await load();
    expect(screen.queryByRole("textbox", { name: "کد ارز" })).toBeNull();
    expect(api.request).toHaveBeenCalledWith(`${path}?currency=IRR`);
    save();
    await waitFor(() => expect(put()).toBeTruthy());
    expect(JSON.parse(put()?.[1].body)).toMatchObject({ currency: "IRR", state: "EnabledOverride" });
  });

  it("does not submit the surrounding Property wizard form from the dialog", async () => {
    const submitWizard = vi.fn((event: React.FormEvent) => event.preventDefault());
    mockResponse();
    render(<form onSubmit={submitWizard}><PropertyCashbackSettings propertyId={17} /></form>);
    await screen.findByText("وضعیت: تنظیم اختصاصی فعال");
    fireEvent.click(screen.getByRole("button", { name: "تنظیمات" }));
    await screen.findByRole("spinbutton", { name: /درصد کش‌بک/ });
    save();
    await waitFor(() => expect(put()).toBeTruthy());
    expect(submitWizard).not.toHaveBeenCalled();
  });

  it("prevents duplicate saves while PUT is pending", async () => {
    await load();
    let resolve!: (value: typeof override) => void;
    api.request.mockImplementation((url: string) => url === path
      ? new Promise((done) => { resolve = done; }) : Promise.resolve(override));
    save();
    await waitFor(() => expect(put()).toBeTruthy());
    const button = screen.getByRole("button", { name: "ذخیره تنظیمات کش‌بک" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
    expect(api.request.mock.calls.filter(([url]) => url === path)).toHaveLength(1);
    resolve(override);
    await waitFor(() => expect(button.disabled).toBe(false));
  });

  it("retains edits and never reports success after backend validation failure", async () => {
    await load();
    api.request.mockImplementation((url: string) => url === path
      ? Promise.reject(new Error("Percentage invalid")) : Promise.resolve(override));
    input(/درصد کش‌بک/, "11");
    save();
    await waitFor(() => expect(notifications.error).toHaveBeenCalled());
    expect((screen.getByRole("spinbutton", { name: /درصد کش‌بک/ }) as HTMLInputElement).value).toBe("11");
    expect(notifications.success).not.toHaveBeenCalled();
  });
});
