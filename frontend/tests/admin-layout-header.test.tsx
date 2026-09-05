import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AdminLayout } from "@/components/dashboard/DashboardLayouts";
import { KoochPageHeader } from "@/components/KoochPageHeader";

vi.mock("next/navigation", () => ({
  usePathname: () => "/admin/users",
  useRouter: () => ({ replace: vi.fn() }),
}));

vi.mock("@/components/auth/AuthSessionProvider", () => ({
  resolveSessionDestination: () => "/",
  useAuthSession: () => ({
    authenticated: true,
    loading: false,
    platformPermissions: [],
    platformRole: "SuperAdmin",
    refreshSession: vi.fn(),
    workspaces: ["admin"],
  }),
}));

vi.mock("@/components/KoochUserMenu", () => ({
  KoochUserMenu: () => <button type="button">حساب کاربری</button>,
}));

describe("Admin header layout", () => {
  it("keeps global search in the integrated navbar", () => {
    render(
      <AdminLayout>
        <KoochPageHeader
          appearance="plain"
          description="فهرست کاربران سامانه"
          eyebrow="پنل مدیریت"
          title="مدیریت کاربران"
        />
      </AdminLayout>,
    );

    const globalSearch = screen.getByPlaceholderText(
      "جستجو در اقامتگاه، رزرو، کاربر...",
    );
    expect(globalSearch.getAttribute("type")).toBe("search");
    const navbar = globalSearch.closest("header");
    expect(navbar?.className).toContain("bg-background");
    expect(navbar?.className).not.toContain("bg-white");
    const shell = navbar?.parentElement?.parentElement?.parentElement;
    expect(shell?.className).toContain("bg-background");

    fireEvent.click(
      screen.getByRole("button", { name: "تغییر حالت روشن و تیره" }),
    );
    expect(shell?.className).toContain("dark");
    expect(globalSearch.closest("header")?.className).toContain("bg-background");
  });

  it("renders the compact breadcrumb and lighter title hierarchy", () => {
    render(
      <KoochPageHeader
        appearance="plain"
        description="فهرست کاربران سامانه"
        eyebrow="پنل مدیریت"
        title="مدیریت کاربران"
      />,
    );

    const breadcrumb = document.querySelector('[data-slot="page-breadcrumb"]');
    expect(breadcrumb?.textContent).toBe("پنل مدیریت");
    expect(breadcrumb?.className).toContain("font-normal");
    expect(screen.queryByRole("navigation")).toBeNull();
    const title = screen.getByRole("heading", { name: "مدیریت کاربران" });
    expect(title.className).toContain("font-semibold");
    expect(title.className).not.toContain("font-bold");
    expect(title.closest("header")?.className).toContain("py-1");
    expect(title.closest("header")?.className).not.toContain("bg-card");
    expect(screen.getByText("فهرست کاربران سامانه").className).toContain(
      "font-normal",
    );
  });

  it("preserves the existing card appearance for non-Admin consumers", () => {
    render(
      <KoochPageHeader
        description="فهرست رزروهای حساب کاربری"
        eyebrow="حساب کاربری"
        title="رزروهای من"
      />,
    );

    const title = screen.getByRole("heading", { name: "رزروهای من" });
    expect(title.className).toContain("font-bold");
    expect(title.closest("header")?.className).toContain("bg-card");
    expect(screen.getByText("حساب کاربری").className).toContain("font-bold");
    expect(
      screen.getByText("فهرست رزروهای حساب کاربری").className,
    ).not.toContain("max-w-3xl");
  });
});
