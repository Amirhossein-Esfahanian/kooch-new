import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => vi.fn());
const notifications = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));
vi.mock("sonner", () => ({ toast: notifications }));
vi.mock("@/components/auth/AuthSessionProvider", () => ({
  useAuthSession: () => ({ authenticated: true, loading: false, workspaces: ["admin"] }),
}));
vi.mock("@/components/dashboard/DashboardLayouts", () => ({
  AdminLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/lib/owner-api", () => ({ apiRequest: api, getToken: () => null }));

import AdminSiteSettingsPage from "@/app/admin/site-settings/page";

const settings = ["site.logoUrl", "home.heroBackgroundUrl"].map((key, index) => ({
  id: index + 1, key, value: `/images/${index}.png`, type: "ImageUrl", group: "Brand",
  label: key, description: null, sortOrder: index, isActive: true,
  createdAtUtc: "2026-09-01T00:00:00Z", updatedAtUtc: null,
}));

function openDelete(index = 0) {
  fireEvent.click(screen.getAllByRole("button", { name: "گزینه‌های تصویر" })[index]);
  const remove = screen.getByRole("menuitem", { name: "حذف" });
  expect(remove).toHaveProperty("disabled", false);
  fireEvent.click(remove);
  expect(screen.queryByRole("menu")).toBeNull();
  return screen.getByRole("alertdialog", { name: "حذف تصویر" });
}

describe("Site Settings persisted image deletion", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path.endsWith("pricing-bounds")) return { minPrice: 0, maxPrice: 1000000 };
      if (init?.method === "DELETE") return { ...settings.find((item) => path.includes(item.key)), value: "" };
      return settings;
    });
  });

  it.each(settings.map((item, index) => [item.key, index] as const))(
    "confirms and deletes %s, synchronizing the uploader without a generic PUT",
    async (key, index) => {
      render(<AdminSiteSettingsPage />);
      await screen.findAllByRole("button", { name: "گزینه‌های تصویر" });
      let dialog = openDelete(index);
      expect(api.mock.calls.filter(([, init]) => init?.method === "DELETE")).toHaveLength(0);
      fireEvent.click(within(dialog).getByRole("button", { name: "انصراف" }));
      expect(screen.getAllByRole("button", { name: "مشاهده" })).toHaveLength(2);
      dialog = openDelete(index);
      fireEvent.click(within(dialog).getByRole("button", { name: "حذف تصویر" }));
      await waitFor(() => expect(api).toHaveBeenCalledWith(`/admin/site-settings/${key}/image`, { method: "DELETE" }));
      await screen.findByText("Add photo");
      expect(screen.getAllByRole("button", { name: "مشاهده" })).toHaveLength(1);
      expect(document.querySelector(`img[src="${settings[index].value}"]`)).toBeNull();
      expect(api.mock.calls.filter(([, init]) => init?.method === "PUT")).toHaveLength(0);
      expect(notifications.success).toHaveBeenCalledWith("تصویر حذف شد");
    },
  );

  it("keeps the persisted image on failure and prevents duplicate pending requests", async () => {
    render(<AdminSiteSettingsPage />);
    await screen.findAllByRole("button", { name: "گزینه‌های تصویر" });
    let reject!: (error: Error) => void;
    api.mockImplementationOnce(() => new Promise((_, fail) => { reject = fail; }));
    const dialog = openDelete();
    const confirm = within(dialog).getByRole("button", { name: "حذف تصویر" });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    expect(confirm).toHaveProperty("disabled", true);
    expect(api.mock.calls.filter(([, init]) => init?.method === "DELETE")).toHaveLength(1);
    expect(document.querySelector('img[src="/images/0.png"]')).not.toBeNull();
    await act(async () => reject(new Error("حذف تصویر ممکن نیست")));
    expect(notifications.error).toHaveBeenCalledWith("حذف تصویر ممکن نیست");
    expect(document.querySelector('img[src="/images/0.png"]')).not.toBeNull();
    expect(screen.queryByText("Add photo")).toBeNull();
  });
});
