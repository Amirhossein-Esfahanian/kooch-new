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

vi.mock("sonner", () => ({ toast: notifications }));
vi.mock("@/components/auth/AuthSessionProvider", () => ({
  useAuthSession: () => ({
    authenticated: true,
    loading: false,
    workspaces: ["admin"],
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

const genericSettings = [
  setting(1, "site.name", "کوچ", "Text", "Brand", "نام سایت", "نام نمایشی سایت"),
  setting(
    2,
    "home.heroSubtitle",
    "زیرعنوان",
    "LongText",
    "Homepage",
    "زیرعنوان هیرو",
    "متن تکمیلی صفحه نخست",
  ),
  setting(
    3,
    "image.maxImagesPerProperty",
    "30",
    "Number",
    "Images",
    "حداکثر تصاویر هر اقامتگاه",
    "مجموع تصاویر اقامتگاه و اتاق‌ها",
  ),
  setting(
    4,
    "image.enableWebpConversion",
    "true",
    "Boolean",
    "Images",
    "تبدیل خودکار به WebP",
    "نسخه کم‌حجم تصویر ذخیره می‌شود",
  ),
  setting(
    5,
    "pricing.currencyLabel",
    "تومان",
    "Text",
    "Pricing",
    "واحد پول قیمت‌گذاری",
    "کنار مبلغ‌ها نمایش داده می‌شود",
  ),
  setting(
    6,
    "ReservationCommissionPercent",
    "5",
    "Number",
    "Reservation",
    "درصد کمیسیون رزرو",
    "درصد کمیسیون جریان آینده",
  ),
  setting(
    7,
    "future.numericLimit",
    "4",
    "Number",
    "Future",
    "محدودیت آینده",
    "یک تنظیم آزمایشی آینده",
  ),
];

describe("Admin Site Settings generic field accessibility", () => {
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

  it("associates Text, LongText, Number, and Boolean labels with real controls", async () => {
    render(<AdminSiteSettingsPage />);

    const text = await screen.findByLabelText("نام سایت");
    const longText = screen.getByLabelText("زیرعنوان هیرو");
    const number = screen.getByLabelText("حداکثر تصاویر هر اقامتگاه");
    const boolean = screen.getByLabelText("تبدیل خودکار به WebP");

    expect(text.tagName).toBe("INPUT");
    expect(longText.tagName).toBe("TEXTAREA");
    expect(number.getAttribute("type")).toBe("number");
    expect(boolean.tagName).toBe("SELECT");
    expect(new Set([text.id, longText.id, number.id, boolean.id]).size).toBe(4);

    for (const [control, description] of [
      [text, "نام نمایشی سایت"],
      [longText, "متن تکمیلی صفحه نخست"],
      [number, "مجموع تصاویر اقامتگاه و اتاق‌ها"],
      [boolean, "نسخه کم‌حجم تصویر ذخیره می‌شود"],
    ] as const) {
      const descriptionElement = screen.getByText(description);
      expect(control.getAttribute("aria-describedby")).toContain(
        descriptionElement.id,
      );
    }
  });

  it("shows and clears an inline numeric error with complete ARIA references", async () => {
    render(<AdminSiteSettingsPage />);

    const number = await screen.findByLabelText("حداکثر تصاویر هر اقامتگاه");
    const description = screen.getByText("مجموع تصاویر اقامتگاه و اتاق‌ها");
    fireEvent.change(number, { target: { value: "0" } });

    const error = screen.getByText("مقدار باید حداقل ۱ باشد");
    expect(number.getAttribute("aria-invalid")).toBe("true");
    expect(number.getAttribute("aria-describedby")?.split(" ")).toEqual(
      expect.arrayContaining([description.id, error.id]),
    );
    fireEvent.click(saveButtonFor(number));
    expect(
      ownerApi.request.mock.calls.filter(([, options]) => options?.method === "PUT"),
    ).toHaveLength(0);

    fireEvent.change(number, { target: { value: "5" } });
    expect(screen.queryByText("مقدار باید حداقل ۱ باشد")).toBeNull();
    expect(number.getAttribute("aria-invalid")).toBeNull();
    expect(number.getAttribute("aria-describedby")).toBe(description.id);
  });

  it("marks only the invalid commission and keeps its PUT blocked", async () => {
    render(<AdminSiteSettingsPage />);

    const commission = await screen.findByLabelText("کمیسیون رزرو عادی");
    const unrelatedNumber = screen.getByLabelText("حداکثر تصاویر هر اقامتگاه");
    fireEvent.change(commission, { target: { value: "101" } });

    const error = screen.getByText("درصد کمیسیون باید بین ۰ تا ۱۰۰ باشد");
    expect(commission.getAttribute("aria-invalid")).toBe("true");
    expect(commission.getAttribute("aria-describedby")).toContain(error.id);
    expect(unrelatedNumber.getAttribute("aria-invalid")).toBeNull();
    fireEvent.click(saveButtonFor(commission));

    expect(
      ownerApi.request.mock.calls.filter(([, options]) => options?.method === "PUT"),
    ).toHaveLength(0);
    expect(notifications.error).not.toHaveBeenCalled();
  });

  it("applies the same semantics in fallback and preserves server-error feedback", async () => {
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

    const fallbackNumber = await screen.findByLabelText("محدودیت آینده");
    const fallbackDescription = screen.getByText("یک تنظیم آزمایشی آینده");
    expect(fallbackNumber.getAttribute("aria-describedby")).toBe(
      fallbackDescription.id,
    );
    expect(screen.queryByText("future.numericLimit")).toBeNull();

    const siteName = screen.getByLabelText("نام سایت");
    fireEvent.change(siteName, { target: { value: "کوچ جدید" } });
    fireEvent.click(saveButtonFor(siteName));

    await waitFor(() =>
      expect(notifications.error).toHaveBeenCalledWith("ذخیره ناموفق بود"),
    );
  });
});

function saveButtonFor(control: HTMLElement) {
  const settingCard = control.closest("div.grid.gap-3");
  expect(settingCard).toBeTruthy();
  return within(settingCard as HTMLElement).getByRole("button", {
    name: "ذخیره",
  });
}

function setting(
  id: number,
  key: string,
  value: string,
  type: "Text" | "LongText" | "Number" | "Boolean",
  group: string,
  label: string,
  description: string,
) {
  return {
    id,
    key,
    value,
    type,
    group,
    label,
    description,
    sortOrder: id,
    isActive: true,
    createdAtUtc: "2026-08-07T00:00:00Z",
    updatedAtUtc: null,
  };
}
