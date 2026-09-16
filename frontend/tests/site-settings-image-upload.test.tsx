import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const ownerApi = vi.hoisted(() => ({ request: vi.fn() }));
const notifications = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));
const uploadedValues = vi.hoisted(() =>
  new Map<string, Record<string, unknown>>(),
);

vi.mock("sonner", () => ({ toast: notifications }));
vi.mock("@/components/auth/AuthSessionProvider", () => ({
  useAuthSession: () => ({
    authenticated: true,
    loading: false,
    workspaces: ["admin"],
  }),
}));
vi.mock("@/components/dashboard/DashboardLayouts", () => ({
  AdminLayout: ({
    children,
    requiredPlatformPermission,
  }: {
    children: React.ReactNode;
    requiredPlatformPermission?: string;
  }) => (
    <div data-required-permission={requiredPlatformPermission}>{children}</div>
  ),
}));
vi.mock("@/components/SharedUploader", () => ({
  SharedUploader: ({
    autoUpload,
    enableCrop,
    existingFiles,
    extraFormFields,
    labels,
    onUploadError,
    onUploadSuccess,
  }: {
    autoUpload?: boolean;
    enableCrop?: boolean;
    existingFiles?: Array<{ url: string }>;
    extraFormFields?: Record<string, string>;
    labels?: { description?: string };
    onUploadError?: (error: string) => void;
    onUploadSuccess?: (uploaded: Record<string, unknown>) => void;
  }) => {
    const key = extraFormFields?.key ?? "unknown";
    const [cropPending, setCropPending] = useState(false);
    const completeUpload = () => {
      const uploaded = uploadedValues.get(key);
      if (uploaded) onUploadSuccess?.(uploaded);
    };

    return (
      <div data-auto-upload={autoUpload} data-testid={`uploader-${key}`}>
        <p>{labels?.description}</p>
        <span data-testid={`image-value-${key}`}>
          {existingFiles?.[0]?.url ?? ""}
        </span>
        <button
          onClick={() => {
            if (!autoUpload) return;
            if (enableCrop) {
              setCropPending(true);
              return;
            }
            completeUpload();
          }}
          type="button"
        >
          {`select-${key}`}
        </button>
        {cropPending && (
          <button
            onClick={() => {
              setCropPending(false);
              completeUpload();
            }}
            type="button"
          >
            {`confirm-crop-${key}`}
          </button>
        )}
        <button
          onClick={() => onUploadError?.("upload failed")}
          type="button"
        >
          {`fail-${key}`}
        </button>
      </div>
    );
  },
}));
vi.mock("@/lib/owner-api", () => ({
  apiRequest: ownerApi.request,
  getToken: () => null,
}));

import AdminSiteSettingsPage from "@/app/admin/site-settings/page";

const initialSettings = [
  setting(1, "site.logoUrl", "/images/original-logo.png", "ImageUrl", "Brand"),
  setting(
    2,
    "home.heroBackgroundUrl",
    "/images/original-hero.jpg",
    "ImageUrl",
    "Homepage",
  ),
  setting(3, "site.name", "Kooch", "Text", "Brand"),
];

describe("Site Settings image upload persistence", () => {
  beforeEach(() => {
    ownerApi.request.mockReset();
    notifications.error.mockReset();
    notifications.success.mockReset();
    uploadedValues.clear();
    ownerApi.request.mockImplementation(
      async (path: string, options?: { method?: string; body?: string }) => {
        if (path === "/admin/site-settings/pricing-bounds") {
          return { minPrice: 100000, maxPrice: 10000000 };
        }
        if (!options?.method) return initialSettings;
        const key = decodeURIComponent(path.split("/").at(-1) ?? "");
        const value = JSON.parse(options.body ?? "{}").value as string;
        return { ...initialSettings.find((item) => item.key === key), value };
      },
    );
  });

  it("does not expose generic Save for ImageUrl settings", async () => {
    render(<AdminSiteSettingsPage />);

    await screen.findByTestId("uploader-site.logoUrl");

    expect(
      document.querySelector('[data-required-permission="ManageSettings"]'),
    ).toBeTruthy();

    expect(screen.getAllByRole("button", { name: "ذخیره" })).toHaveLength(1);
    expect(screen.getByRole("button", { name: "ذخیره" })).toBeTruthy();
  });

  it("opts both image settings into auto-upload with flow-specific guidance", async () => {
    render(<AdminSiteSettingsPage />);

    const logo = await screen.findByTestId("uploader-site.logoUrl");
    const hero = screen.getByTestId("uploader-home.heroBackgroundUrl");

    expect(logo.dataset.autoUpload).toBe("true");
    expect(hero.dataset.autoUpload).toBe("true");
    expect(
      screen.getByText(
        "پس از انتخاب فایل معتبر، تصویر به‌صورت خودکار بارگذاری و ذخیره می‌شود.",
      ),
    ).toBeTruthy();
    expect(
      screen.getByText(
        "پس از انتخاب و تأیید برش تصویر، فایل به‌صورت خودکار بارگذاری و ذخیره می‌شود.",
      ),
    ).toBeTruthy();
  });

  it.each([
    ["site.logoUrl", "/uploads/site-settings/1/new-logo.png"],
    ["home.heroBackgroundUrl", "/uploads/site-settings/2/new-hero.webp"],
  ])(
    "syncs %s to the persisted URL returned by a successful upload",
    async (key, uploadedUrl) => {
      uploadedValues.set(key, {
        ...initialSettings.find((item) => item.key === key),
        value: uploadedUrl,
      });
      render(<AdminSiteSettingsPage />);

      await screen.findByTestId(`uploader-${key}`);
      fireEvent.click(screen.getByRole("button", { name: `select-${key}` }));
      if (key === "home.heroBackgroundUrl") {
        expect(screen.getByTestId(`image-value-${key}`).textContent).toBe(
          "/images/original-hero.jpg",
        );
        fireEvent.click(
          screen.getByRole("button", { name: `confirm-crop-${key}` }),
        );
      }

      expect(screen.getByTestId(`image-value-${key}`).textContent).toBe(
        uploadedUrl,
      );
      expect(
        ownerApi.request.mock.calls.filter(
          ([, options]) => options?.method === "PUT",
        ),
      ).toHaveLength(0);
    },
  );

  it("preserves the previous image and unrelated drafts after upload failure", async () => {
    render(<AdminSiteSettingsPage />);

    const textInput = await screen.findByRole("textbox");
    fireEvent.change(textInput, { target: { value: "Kooch draft" } });
    fireEvent.click(
      screen.getByRole("button", { name: "fail-site.logoUrl" }),
    );

    expect(
      screen.getByTestId("image-value-site.logoUrl").textContent,
    ).toBe("/images/original-logo.png");
    expect((textInput as HTMLInputElement).value).toBe("Kooch draft");
    expect(
      ownerApi.request.mock.calls.filter(
        ([, options]) => options?.method === "PUT",
      ),
    ).toHaveLength(0);
  });

  it("preserves unrelated drafts after a successful image upload", async () => {
    uploadedValues.set("site.logoUrl", {
      ...initialSettings[0],
      value: "/uploads/site-settings/1/new-logo.png",
    });
    render(<AdminSiteSettingsPage />);

    const textInput = await screen.findByRole("textbox");
    fireEvent.change(textInput, { target: { value: "Kooch draft" } });
    fireEvent.click(
      screen.getByRole("button", { name: "select-site.logoUrl" }),
    );

    expect((textInput as HTMLInputElement).value).toBe("Kooch draft");
    expect(
      screen.getByTestId("image-value-site.logoUrl").textContent,
    ).toBe("/uploads/site-settings/1/new-logo.png");
  });

  it("keeps the existing generic Save behavior for non-image settings", async () => {
    render(<AdminSiteSettingsPage />);

    const textInput = await screen.findByRole("textbox");
    fireEvent.change(textInput, { target: { value: "Kooch updated" } });
    fireEvent.click(screen.getByRole("button", { name: "ذخیره" }));

    await waitFor(() =>
      expect(ownerApi.request).toHaveBeenCalledWith(
        "/admin/site-settings/site.name",
        {
          method: "PUT",
          body: JSON.stringify({ value: "Kooch updated" }),
        },
      ),
    );
    expect(notifications.success).toHaveBeenCalledWith(
      "تنظیمات سایت ذخیره شد",
    );
  });
});

function setting(
  id: number,
  key: string,
  value: string,
  type: "Text" | "ImageUrl",
  group: string,
) {
  return {
    id,
    key,
    value,
    type,
    group,
    label: key,
    description: null,
    sortOrder: id,
    isActive: true,
    createdAtUtc: "2026-08-07T00:00:00Z",
    updatedAtUtc: null,
  };
}
