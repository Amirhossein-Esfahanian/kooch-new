import type { ReactNode } from "react";
import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AdminPropertyPanel } from "@/components/admin/AdminPropertyPanel";

const apiRequestMock = vi.fn();

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: { children: ReactNode; href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("@/components/auth/AuthSessionProvider", () => ({
  useAuthSession: () => ({
    authenticated: true,
    loading: false,
    workspaces: ["admin"],
  }),
}));

vi.mock("@/components/dashboard/DashboardLayouts", () => ({
  AdminLayout: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock("@/lib/owner-api", () => ({
  apiRequest: (...args: unknown[]) => apiRequestMock(...args),
}));

describe("Admin property navigation", () => {
  beforeEach(() => {
    apiRequestMock.mockReset();
    apiRequestMock.mockResolvedValue({
      id: 17,
      name: "خانه قاجاری",
      slug: "qajar-house",
    });
  });

  it("uses the loaded property name in a complete clickable sub-page breadcrumb", async () => {
    render(
      <AdminPropertyPanel
        actions={<a href="/admin/properties/17">بازگشت به ویرایش اقامتگاه</a>}
        description="مدیریت اتاق‌های این اقامتگاه"
        propertyId={17}
        sectionLabel="اتاق‌ها"
        showPricingWarnings={false}
        title="مدیریت اتاق‌ها"
      >
        <div>فهرست نوع‌های اتاق</div>
      </AdminPropertyPanel>,
    );

    const breadcrumb = await screen.findByRole("navigation", {
      name: "مسیر صفحه",
    });
    expect(apiRequestMock).toHaveBeenCalledWith("/admin/properties/17");
    expect(within(breadcrumb).getByRole("link", { name: "پنل مدیریت" }).getAttribute("href")).toBe(
      "/admin",
    );
    expect(within(breadcrumb).getByRole("link", { name: "اقامتگاه‌ها" }).getAttribute("href")).toBe(
      "/admin/properties",
    );
    expect(within(breadcrumb).getByRole("link", { name: "خانه قاجاری" }).getAttribute("href")).toBe(
      "/admin/properties/17",
    );
    expect(within(breadcrumb).getByText("اتاق‌ها").getAttribute("aria-current")).toBe(
      "page",
    );
    expect(
      within(breadcrumb).queryByRole("link", { name: "اتاق‌ها" }),
    ).toBeNull();
  });
});
