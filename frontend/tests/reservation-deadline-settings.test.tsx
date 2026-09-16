import { render, screen } from "@testing-library/react";
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

describe("generic Site Settings reservation boundary", () => {
  beforeEach(() => {
    ownerApi.request.mockReset();
    notifications.error.mockReset();
    notifications.success.mockReset();
    ownerApi.request.mockImplementation(async (path: string) => {
      if (path === "/admin/site-settings/pricing-bounds") {
        return { minPrice: 100000, maxPrice: 10000000 };
      }

      return [
        setting(1, "site.footerText", "متن پایین صفحه", "متن عمومی پایین سایت."),
      ];
    });
  });

  it("renders unrelated settings without exposing reservation-owned settings", async () => {
    render(<AdminSiteSettingsPage />);

    expect(await screen.findByText("متن پایین صفحه")).toBeTruthy();
    expect(screen.queryByText("مهلت پرداخت رزرو")).toBeNull();
    expect(screen.queryByText("مهلت پاسخ مالک به رزرو استعلامی")).toBeNull();
    expect(
      screen.queryByText("فاصله یادآوری رزروهای در انتظار تأیید"),
    ).toBeNull();
    expect(ownerApi.request).toHaveBeenCalledWith("/admin/site-settings");
  });
});

function setting(
  id: number,
  key: string,
  label: string,
  description: string,
  value = "10",
) {
  return {
    id,
    key,
    value,
    type: "Number",
    group: "Reservation",
    label,
    description,
    sortOrder: id,
    isActive: true,
    createdAtUtc: "2026-08-07T00:00:00Z",
    updatedAtUtc: null,
  };
}
