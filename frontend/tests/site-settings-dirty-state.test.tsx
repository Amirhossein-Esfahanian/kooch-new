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
  SharedUploader: () => <div data-testid="image-uploader" />,
}));
vi.mock("@/lib/owner-api", () => ({
  apiRequest: ownerApi.request,
  getToken: () => null,
}));

import AdminSiteSettingsPage from "@/app/admin/site-settings/page";

const genericSettings = [
  setting(1, "site.name", "کوچ", "Text", "Brand", "نام سایت"),
  setting(2, "site.logoUrl", "/logo.svg", "ImageUrl", "Brand", "آدرس لوگو"),
  setting(3, "home.heroSubtitle", "زیرعنوان", "LongText", "Homepage", "زیرعنوان هیرو"),
  setting(4, "image.maxImagesPerProperty", "10", "Number", "Images", "حداکثر تصاویر"),
  setting(5, "image.enableWebpConversion", "true", "Boolean", "Images", "تبدیل WebP"),
  setting(6, "pricing.currencyLabel", "تومان", "Text", "Pricing", "واحد پول"),
  setting(7, "site.defaultSeoTitle", "سئوی کوچ", "Text", "SEO", "عنوان سئو"),
  setting(8, "ReservationCommissionPercent", "5", "Number", "Reservation", "کمیسیون"),
  setting(9, "future.message", "آینده", "Text", "Future", "تنظیم آینده"),
];

describe("Admin Site Settings generic dirty state", () => {
  beforeEach(() => {
    ownerApi.request.mockReset();
    notifications.error.mockReset();
    notifications.success.mockReset();
    ownerApi.request.mockImplementation(
      async (path: string, options?: { method?: string; body?: string }) => {
        if (path === "/admin/site-settings/pricing-bounds") {
          return { minPrice: 100, maxPrice: 1000 };
        }
        if (path === "/admin/site-settings") return genericSettings;

        const key = decodeURIComponent(path.split("/").at(-1) ?? "");
        return {
          ...genericSettings.find((item) => item.key === key),
          value: JSON.parse(options?.body ?? "{}").value,
        };
      },
    );
  });

  it("enables only a changed Text setting and becomes clean after success", async () => {
    render(<AdminSiteSettingsPage />);

    const siteName = await screen.findByLabelText("نام سایت");
    const seoTitle = screen.getByLabelText("عنوان سئو");
    const siteNameSave = saveButtonFor(siteName);
    const seoSave = saveButtonFor(seoTitle);

    expect(siteNameSave.disabled).toBe(true);
    expect(seoSave.disabled).toBe(true);
    fireEvent.click(siteNameSave);
    expect(genericPutCalls()).toHaveLength(0);

    fireEvent.change(siteName, { target: { value: "کوچ جدید" } });
    expect(siteNameSave.disabled).toBe(false);
    expect(seoSave.disabled).toBe(true);
    fireEvent.click(siteNameSave);

    await waitFor(() =>
      expect(ownerApi.request).toHaveBeenCalledWith(
        "/admin/site-settings/site.name",
        { method: "PUT", body: JSON.stringify({ value: "کوچ جدید" }) },
      ),
    );
    await waitFor(() => expect(siteNameSave.disabled).toBe(true));
    expect(genericPutCalls()).toHaveLength(1);
  });

  it("disables only the pending setting and prevents duplicate submission", async () => {
    let resolveSave: ((value: (typeof genericSettings)[number]) => void) | undefined;
    ownerApi.request.mockImplementation(
      async (path: string, options?: { method?: string; body?: string }) => {
        if (path === "/admin/site-settings/pricing-bounds") {
          return { minPrice: 100, maxPrice: 1000 };
        }
        if (path === "/admin/site-settings") return genericSettings;
        if (path.endsWith("site.name") && options?.method === "PUT") {
          return new Promise((resolve) => {
            resolveSave = resolve;
          });
        }
        return genericSettings[0];
      },
    );
    render(<AdminSiteSettingsPage />);

    const siteName = await screen.findByLabelText("نام سایت");
    const seoTitle = screen.getByLabelText("عنوان سئو");
    const siteNameSave = saveButtonFor(siteName);
    const seoSave = saveButtonFor(seoTitle);
    fireEvent.change(siteName, { target: { value: "کوچ جدید" } });
    fireEvent.change(seoTitle, { target: { value: "سئوی جدید" } });
    fireEvent.click(siteNameSave);

    expect(siteNameSave.disabled).toBe(true);
    expect(seoSave.disabled).toBe(false);
    fireEvent.click(siteNameSave);
    expect(genericPutCalls()).toHaveLength(1);

    resolveSave?.({ ...genericSettings[0], value: "کوچ جدید" });
    await waitFor(() => expect(siteNameSave.disabled).toBe(true));
    expect(seoSave.disabled).toBe(false);
  });

  it("keeps Text and LongText drafts independently dirty and restores Save after failure", async () => {
    ownerApi.request.mockImplementation(
      async (path: string, options?: { method?: string }) => {
        if (path === "/admin/site-settings/pricing-bounds") {
          return { minPrice: 100, maxPrice: 1000 };
        }
        if (path === "/admin/site-settings") return genericSettings;
        if (path.endsWith("site.name") && options?.method === "PUT") {
          throw new Error("ذخیره ناموفق بود");
        }
        return genericSettings[0];
      },
    );
    render(<AdminSiteSettingsPage />);

    const siteName = await screen.findByLabelText("نام سایت");
    const subtitle = screen.getByLabelText("زیرعنوان هیرو");
    const siteNameSave = saveButtonFor(siteName);
    const subtitleSave = saveButtonFor(subtitle);

    fireEvent.change(subtitle, { target: { value: "زیرعنوان جدید" } });
    expect(subtitleSave.disabled).toBe(false);
    expect(siteNameSave.disabled).toBe(true);

    fireEvent.change(siteName, { target: { value: "پیش‌نویس نام" } });
    fireEvent.click(siteNameSave);
    await waitFor(() =>
      expect(notifications.error).toHaveBeenCalledWith("ذخیره ناموفق بود"),
    );
    expect((siteName as HTMLInputElement).value).toBe("پیش‌نویس نام");
    expect(siteNameSave.disabled).toBe(false);
    expect(subtitleSave.disabled).toBe(false);
  });

  it("uses numeric equivalence while keeping invalid drafts disabled", async () => {
    render(<AdminSiteSettingsPage />);

    const number = await screen.findByLabelText("حداکثر تصاویر");
    const save = saveButtonFor(number);
    fireEvent.change(number, { target: { value: "10.0" } });
    expect((number as HTMLInputElement).value).toBe("10.0");
    expect(save.disabled).toBe(true);

    fireEvent.change(number, { target: { value: "10.5" } });
    expect(save.disabled).toBe(false);

    fireEvent.change(number, { target: { value: "0" } });
    expect(number.getAttribute("aria-invalid")).toBe("true");
    expect(save.disabled).toBe(true);

    fireEvent.change(number, { target: { value: "12" } });
    expect(number.getAttribute("aria-invalid")).toBeNull();
    expect(save.disabled).toBe(false);
  });

  it("tracks Boolean and fallback settings independently", async () => {
    render(<AdminSiteSettingsPage />);

    const boolean = await screen.findByLabelText("تبدیل WebP");
    const fallback = screen.getByLabelText("تنظیم آینده");
    const booleanSave = saveButtonFor(boolean);
    const fallbackSave = saveButtonFor(fallback);

    expect(booleanSave.disabled).toBe(true);
    expect(fallbackSave.disabled).toBe(true);
    fireEvent.change(boolean, { target: { value: "false" } });
    expect(booleanSave.disabled).toBe(false);
    expect(fallbackSave.disabled).toBe(true);
    fireEvent.click(booleanSave);
    await waitFor(() => expect(booleanSave.disabled).toBe(true));

    fireEvent.change(fallback, { target: { value: "آینده جدید" } });
    expect(fallbackSave.disabled).toBe(false);
  });

  it("keeps an unrelated valid dirty Save enabled beside an invalid commission", async () => {
    render(<AdminSiteSettingsPage />);

    const currency = await screen.findByLabelText("واحد پول");
    const commission = screen.getByLabelText("کمیسیون رزرو عادی");
    fireEvent.change(currency, { target: { value: "ریال آزمایشی" } });
    fireEvent.change(commission, { target: { value: "101" } });

    expect(saveButtonFor(currency).disabled).toBe(false);
    expect(saveButtonFor(commission).disabled).toBe(true);
    fireEvent.click(saveButtonFor(currency));

    await waitFor(() =>
      expect(ownerApi.request).toHaveBeenCalledWith(
        "/admin/site-settings/pricing.currencyLabel",
        {
          method: "PUT",
          body: JSON.stringify({ value: "ریال آزمایشی" }),
        },
      ),
    );
    expect(screen.getAllByTestId("image-uploader")).toHaveLength(1);
  });
});

function genericPutCalls() {
  return ownerApi.request.mock.calls.filter(
    ([path, options]) =>
      path !== "/admin/site-settings/pricing-bounds" && options?.method === "PUT",
  );
}

function saveButtonFor(control: HTMLElement) {
  const settingCard = control.closest("div.grid.gap-3");
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
