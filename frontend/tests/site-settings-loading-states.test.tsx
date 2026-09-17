import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const ownerApi = vi.hoisted(() => ({ request: vi.fn() }));
const notifications = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));
const authSession = vi.hoisted(() => ({ workspaces: ["admin"] }));

vi.mock("sonner", () => ({ toast: notifications }));
vi.mock("@/components/auth/AuthSessionProvider", () => ({
  useAuthSession: () => ({
    authenticated: true,
    loading: false,
    workspaces: authSession.workspaces,
  }),
}));
vi.mock("@/components/dashboard/DashboardLayouts", () => ({
  AdminLayout: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("@/components/SharedUploader", () => ({
  SharedUploader: () => null,
}));
vi.mock("@/lib/owner-api", () => ({
  apiRequest: ownerApi.request,
  getToken: () => null,
}));

import AdminSiteSettingsPage from "@/app/admin/site-settings/page";

const siteNameSetting = setting(
  1,
  "site.name",
  "کوچ",
  "Text",
  "Brand",
  "نام سایت",
);

describe("Admin Site Settings loading and recovery states", () => {
  beforeEach(() => {
    ownerApi.request.mockReset();
    notifications.error.mockReset();
    notifications.success.mockReset();
  });

  it("shows the standard loading state without generic controls", () => {
    const genericRequest = deferred<typeof siteNameSetting[]>();
    const pricingRequest = deferred<{ minPrice: number; maxPrice: number }>();
    ownerApi.request.mockImplementation((path: string) =>
      path === "/admin/site-settings/pricing-bounds"
        ? pricingRequest.promise
        : genericRequest.promise,
    );

    render(<AdminSiteSettingsPage />);

    expect(screen.getByRole("status").textContent).toContain(
      "در حال بارگذاری تنظیمات",
    );
    expect(screen.queryByLabelText("نام سایت")).toBeNull();
    expect(screen.queryByText("دریافت تنظیمات سایت انجام نشد")).toBeNull();
  });

  it("recovers a failed generic GET with one retry while Pricing Bounds stays independent", async () => {
    const retryRequest = deferred<typeof siteNameSetting[]>();
    let genericGetCount = 0;
    ownerApi.request.mockImplementation((path: string) => {
      if (path === "/admin/site-settings/pricing-bounds") {
        return Promise.resolve({ minPrice: 100, maxPrice: 1000 });
      }
      genericGetCount += 1;
      return genericGetCount === 1
        ? Promise.reject(new Error("raw server detail"))
        : retryRequest.promise;
    });

    render(<AdminSiteSettingsPage />);

    expect(
      await screen.findByText("دریافت تنظیمات سایت انجام نشد"),
    ).toBeTruthy();
    expect(screen.queryByText("raw server detail")).toBeNull();
    expect(screen.getByLabelText(/حداقل قیمت روزانه/)).toBeTruthy();
    expect(screen.queryByLabelText("نام سایت")).toBeNull();

    const retry = screen.getByRole("button", { name: "تلاش دوباره" });
    fireEvent.click(retry);
    fireEvent.click(retry);
    expect(genericGetCount).toBe(2);
    expect(screen.getByRole("status")).toBeTruthy();

    retryRequest.resolve([siteNameSetting]);
    const siteName = await screen.findByLabelText("نام سایت");
    expect((siteName as HTMLInputElement).value).toBe("کوچ");
    expect(screen.queryByText("دریافت تنظیمات سایت انجام نشد")).toBeNull();
  });

  it("restores the recoverable error when retry also fails", async () => {
    let genericGetCount = 0;
    ownerApi.request.mockImplementation((path: string) => {
      if (path === "/admin/site-settings/pricing-bounds") {
        return Promise.resolve({ minPrice: 100, maxPrice: 1000 });
      }
      genericGetCount += 1;
      return Promise.reject(new Error("unavailable"));
    });

    render(<AdminSiteSettingsPage />);

    fireEvent.click(
      await screen.findByRole("button", { name: "تلاش دوباره" }),
    );
    expect(screen.getByRole("status")).toBeTruthy();
    expect(
      await screen.findByRole("button", { name: "تلاش دوباره" }),
    ).toBeTruthy();
    expect(genericGetCount).toBe(2);
    expect(screen.queryByLabelText("نام سایت")).toBeNull();
  });

  it("keeps usable generic settings visible when Pricing Bounds fails", async () => {
    ownerApi.request.mockImplementation((path: string) =>
      path === "/admin/site-settings/pricing-bounds"
        ? Promise.reject(new Error("محدوده قیمت در دسترس نیست"))
        : Promise.resolve([siteNameSetting]),
    );

    render(<AdminSiteSettingsPage />);

    expect(await screen.findByLabelText("نام سایت")).toBeTruthy();
    expect(screen.getByText("محدوده قیمت در دسترس نیست")).toBeTruthy();
    expect(screen.queryByText("دریافت تنظیمات سایت انجام نشد")).toBeNull();
  });

  it("treats an empty generic response as empty while preserving Pricing Bounds", async () => {
    ownerApi.request.mockImplementation((path: string) =>
      path === "/admin/site-settings/pricing-bounds"
        ? Promise.resolve({ minPrice: 100, maxPrice: 1000 })
        : Promise.resolve([]),
    );

    render(<AdminSiteSettingsPage />);

    expect(
      await screen.findByText("تنظیمی برای نمایش وجود ندارد."),
    ).toBeTruthy();
    expect(screen.queryByText("دریافت تنظیمات سایت انجام نشد")).toBeNull();
    expect(screen.getByLabelText(/حداقل قیمت روزانه/)).toBeTruthy();
    expect(screen.queryByLabelText("نام سایت")).toBeNull();
    const navigation = screen.getByRole("navigation", {
      name: "بخش‌های تنظیمات سایت",
    });
    expect(within(navigation).getAllByRole("link")).toHaveLength(1);
    expect(
      within(navigation).getByRole("link", {
        name: "قیمت‌گذاری و نمایش مبلغ",
      }),
    ).toBeTruthy();
  });

  it("renders anchors only for populated sections and keeps PUT failures local", async () => {
    ownerApi.request.mockImplementation(
      async (path: string, options?: { method?: string }) => {
        if (path === "/admin/site-settings/pricing-bounds") {
          return { minPrice: 100, maxPrice: 1000 };
        }
        if (path === "/admin/site-settings") return [siteNameSetting];
        if (path.endsWith("site.name") && options?.method === "PUT") {
          throw new Error("ذخیره انجام نشد");
        }
        return siteNameSetting;
      },
    );

    render(<AdminSiteSettingsPage />);

    const siteName = await screen.findByLabelText("نام سایت");
    const navigation = screen.getByRole("navigation", {
      name: "بخش‌های تنظیمات سایت",
    });
    expect(
      within(navigation).getByRole("link", { name: "هویت و برند" }),
    ).toBeTruthy();
    expect(
      within(navigation).getByRole("link", {
        name: "قیمت‌گذاری و نمایش مبلغ",
      }),
    ).toBeTruthy();
    expect(
      within(navigation).queryByRole("link", { name: "صفحه اصلی" }),
    ).toBeNull();

    fireEvent.change(siteName, { target: { value: "کوچ جدید" } });
    fireEvent.click(saveButtonFor(siteName));
    await waitFor(() =>
      expect(notifications.error).toHaveBeenCalledWith("ذخیره انجام نشد"),
    );
    expect(screen.queryByText("دریافت تنظیمات سایت انجام نشد")).toBeNull();
    expect((siteName as HTMLInputElement).value).toBe("کوچ جدید");
    expect(saveButtonFor(siteName).disabled).toBe(false);
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function saveButtonFor(control: HTMLElement) {
  const settingCard = control.closest("div.grid.gap-4");
  expect(settingCard).toBeTruthy();
  return within(settingCard as HTMLElement).getByRole("button", {
    name: "ذخیره",
  }) as HTMLButtonElement;
}

function setting(
  id: number,
  key: string,
  value: string,
  type: "Text" | "LongText" | "ImageUrl" | "Number" | "Boolean",
  group: string,
  label: string,
) {
  return {
    id,
    key,
    value,
    type,
    group,
    label,
    description: null,
    sortOrder: id,
    isActive: true,
    createdAtUtc: "2026-08-07T00:00:00Z",
    updatedAtUtc: null,
  };
}
