import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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

const genericSettings = [
  setting(1, "pricing.currencyLabel", "تومان", "Text", "Pricing", "واحد پول"),
  setting(2, "site.name", "Kooch", "Text", "Brand", "نام سایت"),
];

describe("Admin Site Settings pricing bounds editor", () => {
  beforeEach(() => {
    ownerApi.request.mockReset();
    notifications.error.mockReset();
    notifications.success.mockReset();
    ownerApi.request.mockImplementation(
      async (path: string, options?: { method?: string; body?: string }) => {
        if (path === "/admin/site-settings/pricing-bounds") {
          if (options?.method === "PUT") {
            return JSON.parse(options.body ?? "{}");
          }
          return { minPrice: 100, maxPrice: 1000 };
        }

        if (path === "/admin/site-settings") return genericSettings;

        const key = decodeURIComponent(path.split("/").at(-1) ?? "");
        const value = JSON.parse(options?.body ?? "{}").value as string;
        return { ...genericSettings.find((item) => item.key === key), value };
      },
    );
  });

  it("renders one dedicated pair from the finalized generic contract", async () => {
    render(<AdminSiteSettingsPage />);

    expect(
      (await screen.findByLabelText(/حداقل قیمت روزانه/)) as HTMLInputElement
    ).toHaveProperty("value", "100");
    expect(
      screen.getByLabelText(/حداکثر قیمت روزانه/) as HTMLInputElement,
    ).toHaveProperty("value", "1000");
    expect(screen.getByText("محدوده قیمت روزانه")).toBeTruthy();
    expect(screen.getAllByLabelText(/حداقل قیمت روزانه/)).toHaveLength(1);
    expect(screen.getAllByLabelText(/حداکثر قیمت روزانه/)).toHaveLength(1);
    expect(screen.queryByText("pricing.minPrice")).toBeNull();
    expect(screen.queryByText("pricing.maxPrice")).toBeNull();
    expect(screen.getByText("pricing.currencyLabel")).toBeTruthy();
    expect(ownerApi.request).toHaveBeenCalledWith(
      "/admin/site-settings/pricing-bounds",
    );
  });

  it.each([
    ["250.5", "2500.75"],
    ["50.25", "750.5"],
  ])("saves changed decimal bounds in one paired PUT", async (min, max) => {
    render(<AdminSiteSettingsPage />);

    const minInput = await screen.findByLabelText(/حداقل قیمت روزانه/);
    const maxInput = screen.getByLabelText(/حداکثر قیمت روزانه/);
    fireEvent.change(minInput, { target: { value: min } });
    fireEvent.change(maxInput, { target: { value: max } });
    fireEvent.click(
      screen.getByRole("button", { name: "ذخیره محدوده قیمت" }),
    );

    await waitFor(() =>
      expect(ownerApi.request).toHaveBeenCalledWith(
        "/admin/site-settings/pricing-bounds",
        {
          method: "PUT",
          body: JSON.stringify({
            minPrice: Number(min),
            maxPrice: Number(max),
          }),
        },
      ),
    );

    const puts = ownerApi.request.mock.calls.filter(
      ([, options]) => options?.method === "PUT",
    );
    expect(puts).toHaveLength(1);
    expect(puts[0]?.[0]).not.toContain("pricing.minPrice");
    expect(puts[0]?.[0]).not.toContain("pricing.maxPrice");
    expect(notifications.success).toHaveBeenCalledWith(
      "محدوده قیمت ذخیره شد",
    );
  });

  it("requires a valid non-negative ordered pair before enabling Save", async () => {
    render(<AdminSiteSettingsPage />);

    const minInput = await screen.findByLabelText(/حداقل قیمت روزانه/);
    const maxInput = screen.getByLabelText(/حداکثر قیمت روزانه/);
    const save = screen.getByRole("button", { name: "ذخیره محدوده قیمت" });

    expect((save as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(minInput, { target: { value: "" } });
    expect(screen.getByText("این مقدار الزامی است")).toBeTruthy();
    expect(minInput.getAttribute("aria-invalid")).toBe("true");
    expect((save as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(minInput, { target: { value: "-1" } });
    expect(screen.getByText("مقدار نمی‌تواند منفی باشد")).toBeTruthy();
    expect((save as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(minInput, { target: { value: "2000" } });
    expect(
      screen.getByText("حداکثر قیمت باید بزرگ‌تر یا مساوی حداقل قیمت باشد"),
    ).toBeTruthy();
    expect(maxInput.getAttribute("aria-invalid")).toBe("true");
    expect((save as HTMLButtonElement).disabled).toBe(true);

    expect(
      ownerApi.request.mock.calls.filter(([, options]) => options?.method === "PUT"),
    ).toHaveLength(0);
  });

  it("keeps the draft and persisted pair unchanged when PUT fails", async () => {
    ownerApi.request.mockImplementation(
      async (path: string, options?: { method?: string }) => {
        if (path === "/admin/site-settings/pricing-bounds") {
          if (options?.method === "PUT") throw new Error("قیمت تکراری است");
          return { minPrice: 100, maxPrice: 1000 };
        }
        return genericSettings;
      },
    );
    render(<AdminSiteSettingsPage />);

    const minInput = await screen.findByLabelText(/حداقل قیمت روزانه/);
    fireEvent.change(minInput, { target: { value: "200" } });
    const save = screen.getByRole("button", { name: "ذخیره محدوده قیمت" });
    await waitFor(() =>
      expect((save as HTMLButtonElement).disabled).toBe(false),
    );
    fireEvent.click(save);

    expect(await screen.findByText("قیمت تکراری است")).toBeTruthy();
    expect((minInput as HTMLInputElement).value).toBe("200");
    expect((save as HTMLButtonElement).disabled).toBe(false);
  });

  it("isolates pricing GET failure from generic setting saves", async () => {
    ownerApi.request.mockImplementation(
      async (path: string, options?: { method?: string; body?: string }) => {
        if (path === "/admin/site-settings/pricing-bounds") {
          throw new Error("دریافت قیمت ناموفق بود");
        }
        if (path === "/admin/site-settings") return genericSettings;
        const key = decodeURIComponent(path.split("/").at(-1) ?? "");
        return {
          ...genericSettings.find((item) => item.key === key),
          value: JSON.parse(options?.body ?? "{}").value,
        };
      },
    );
    render(<AdminSiteSettingsPage />);

    expect(await screen.findByText("دریافت قیمت ناموفق بود")).toBeTruthy();
    const siteName = screen.getByDisplayValue("Kooch");
    fireEvent.change(siteName, { target: { value: "Kooch updated" } });
    fireEvent.click(screen.getAllByRole("button", { name: "ذخیره" })[1]);

    await waitFor(() =>
      expect(ownerApi.request).toHaveBeenCalledWith(
        "/admin/site-settings/site.name",
        {
          method: "PUT",
          body: JSON.stringify({ value: "Kooch updated" }),
        },
      ),
    );
  });

  it("does not let an invalid pricing draft block currencyLabel generic save", async () => {
    render(<AdminSiteSettingsPage />);

    const minInput = await screen.findByLabelText(/حداقل قیمت روزانه/);
    fireEvent.change(minInput, { target: { value: "2000" } });

    const currency = screen.getByDisplayValue("تومان");
    fireEvent.change(currency, { target: { value: "ریال آزمایشی" } });
    fireEvent.click(screen.getAllByRole("button", { name: "ذخیره" })[0]);

    await waitFor(() =>
      expect(ownerApi.request).toHaveBeenCalledWith(
        "/admin/site-settings/pricing.currencyLabel",
        {
          method: "PUT",
          body: JSON.stringify({ value: "ریال آزمایشی" }),
        },
      ),
    );
  });
});

function setting(
  id: number,
  key: string,
  value: string,
  type: "Text" | "Number",
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
