import type { ReactNode } from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AdminPropertyPanel } from "@/components/admin/AdminPropertyPanel";

const apiRequestMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

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

  it("passes the already-loaded Property meal name to a room-page child", async () => {
    apiRequestMock.mockResolvedValue({
      id: 17,
      name: "خانه قاجاری",
      defaultMealPlanName: "صبحانه شامل قیمت",
    });
    render(
      <AdminPropertyPanel propertyId={17} showPricingWarnings={false} title="مدیریت اتاق‌ها">
        {(property) => <span>{property?.defaultMealPlanName ?? "استفاده از پیش‌فرض اقامتگاه"}</span>}
      </AdminPropertyPanel>,
    );

    expect(await screen.findByText("صبحانه شامل قیمت")).toBeTruthy();
    expect(apiRequestMock).toHaveBeenCalledWith("/admin/properties/17");
    expect(apiRequestMock.mock.calls.every(([path]) => path === "/admin/properties/17")).toBe(true);
  });

  it.each([
    [null, true],
    [0, false],
    [100, false],
  ])("uses active RoomTypes for Admin financial warning with extra price %s", async (extraGuestPrice, warns) => {
    apiRequestMock.mockImplementation((path: string) => Promise.resolve(
      path === "/owner/properties/17/room-types"
        ? [{ isActive: true, allowExtraGuest: true, maxExtraGuests: 2 }]
        : { id: 17, name: "خانه قاجاری", childPrice: null, extraGuestPrice },
    ));

    render(<AdminPropertyPanel propertyId={17} title="اقامتگاه"><div>محتوا</div></AdminPropertyPanel>);

    await waitFor(() => expect(apiRequestMock).toHaveBeenCalledWith("/owner/properties/17/room-types"));
    if (warns) {
      expect(await screen.findByText("نرخ نفر اضافه برای این اقامتگاه تعریف نشده است.")).toBeTruthy();
    } else {
      expect(screen.queryByText("نرخ نفر اضافه برای این اقامتگاه تعریف نشده است.")).toBeNull();
    }
    expect(screen.queryByText("نرخ کودک برای این اقامتگاه تعریف نشده است.")).toBeNull();
  });
});
