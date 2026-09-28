import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { OwnerLayout } from "@/components/dashboard/DashboardLayouts";

const visibility = vi.hoisted(() => ({ financialView: false }));
vi.mock("next/navigation", () => ({
  usePathname: () => "/owner/properties/8/settlements",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));
vi.mock("@/components/auth/AuthSessionProvider", () => ({
  useAuthSession: () => ({ authenticated: true, loading: false, workspaces: ["owner"], refreshSession: vi.fn() }),
  resolveSessionDestination: () => "/",
}));
vi.mock("@/components/owner/OwnerPropertyProvider", () => ({
  useOwnerProperty: () => ({
    activeMemberships: [{ propertyId: 8, propertyName: "اقامتگاه نمونه" }],
    effectivePermissions: { Financial: { view: visibility.financialView }, Bookings: { view: true } },
    propertyId: 8, propertyName: "اقامتگاه نمونه", routePropertyIsValid: true,
    switchProperty: vi.fn(),
  }),
}));
vi.mock("@/components/KoochUserMenu", () => ({ KoochUserMenu: () => null }));

describe("Owner settlement navigation", () => {
  it("shows the Property settlement link only with effective financial.view", () => {
    visibility.financialView = false;
    const view = render(<OwnerLayout><p>محتوا</p></OwnerLayout>);
    expect(screen.queryByRole("link", { name: "تسویه‌ها" })).toBeNull();
    expect(screen.getByRole("link", { name: "رزروها" })).toBeTruthy();

    visibility.financialView = true;
    view.rerender(<OwnerLayout><p>محتوا</p></OwnerLayout>);
    expect(screen.getByRole("link", { name: "تسویه‌ها" }).getAttribute("href"))
      .toBe("/owner/properties/8/settlements");
  });
});
