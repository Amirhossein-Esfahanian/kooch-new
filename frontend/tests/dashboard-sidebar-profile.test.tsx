import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  pathname: "/admin",
  push: vi.fn(), replace: vi.fn(), clearSession: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  usePathname: () => mocks.pathname,
  useRouter: () => ({ push: mocks.push, replace: mocks.replace }),
}));
vi.mock("@/components/auth/AuthSessionProvider", () => ({
  useAuthSession: () => ({
    authenticated: true, loading: false, platformRole: "SuperAdmin", platformPermissions: [],
    workspaces: ["account", "admin", "owner"],
    user: { fullName: "سارا رضایی", email: "sara@example.test" },
    clearSession: mocks.clearSession,
  }),
  resolveSessionDestination: (_session: unknown, workspace: string) => `/${workspace}`,
}));
vi.mock("@/components/owner/OwnerPropertyProvider", () => ({
  useOwnerProperty: () => ({
    activeMemberships: [{ propertyId: 11, propertyName: "خانه سرو" }],
    effectivePermissions: { Dashboard: { view: true }, Rooms: { view: true } },
    propertyId: 11, propertyName: "خانه سرو", routePropertyIsValid: true,
    switchProperty: vi.fn(),
  }),
}));
vi.mock("@/lib/site-settings", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/site-settings")>(),
  fetchPublicSiteSettings: async () => ({}),
}));
vi.mock("@/lib/account-notifications", () => ({
  getNotificationUnreadCount: async () => ({ unreadCount: 0 }),
  getNotifications: async () => ({ items: [] }),
  markAllNotificationsRead: vi.fn(), markNotificationRead: vi.fn(),
}));
vi.mock("@/components/KoochUserProfileDialog", () => ({
  KoochUserProfileDialog: ({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) => open ? <div role="dialog" aria-label="تنظیمات حساب"><button onClick={() => onOpenChange(false)}>بستن تنظیمات</button></div> : null,
}));

import { AdminLayout, OwnerLayout } from "@/components/dashboard/DashboardLayouts";
import { KoochUserMenu } from "@/components/KoochUserMenu";

function renderPanel(panel: "admin" | "owner") {
  mocks.pathname = panel === "admin" ? "/admin" : "/owner/properties/11";
  const Layout = panel === "admin" ? AdminLayout : OwnerLayout;
  return render(<Layout><div>محتوای صفحه</div></Layout>);
}

beforeEach(() => vi.clearAllMocks());

describe.each(["admin", "owner"] as const)("%s sidebar profile", (panel) => {
  it("moves one profile trigger to a footer outside the scrollable navigation", () => {
    renderPanel(panel);
    const trigger = screen.getByRole("button", { name: "منوی کاربر سارا رضایی" });
    const footer = trigger.closest("footer");
    const sidebar = screen.getByRole("complementary");
    const nav = within(sidebar).getByRole("navigation");
    expect(footer?.getAttribute("data-slot")).toBe("sidebar-profile");
    expect(footer?.className).toContain("shrink-0");
    expect(nav.className).toContain("flex-1");
    expect(nav.className).toContain("overflow-y-auto");
    expect(nav.contains(trigger)).toBe(false);
    expect(nav.compareDocumentPosition(footer!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(document.querySelector("header")?.contains(trigger)).toBe(false);
    expect(screen.getAllByRole("button", { name: /منوی کاربر سارا/ })).toHaveLength(1);
    expect(within(trigger).getByText("سارا رضایی")).toBeTruthy();
    expect(within(trigger).getByText("sara@example.test")).toBeTruthy();
    expect(screen.getByPlaceholderText("جستجو در اقامتگاه، رزرو، کاربر...")).toBeTruthy();
    expect(screen.getByRole("button", { name: "اعلان‌ها" })).toBeTruthy();
  });

  it("keeps the collapsed trigger accessible and its menu above and inside the viewport bounds", () => {
    renderPanel(panel);
    fireEvent.click(screen.getByRole("button", { name: "جمع کردن منو" }));
    const trigger = screen.getByRole("button", { name: "منوی کاربر سارا رضایی" });
    expect(trigger.getAttribute("title")).toBe("سارا رضایی");
    expect(within(trigger).getByText("سارا رضایی").parentElement?.className).toContain("md:hidden");
    fireEvent.click(trigger);
    const menu = screen.getByRole("menu");
    ["bottom-full", "right-0", "max-h-[calc(100dvh-6rem)]", "max-w-[calc(100vw-2rem)]", "overflow-y-auto"].forEach((token) => expect(menu.className).toContain(token));
    expect(menu.className).not.toContain("top-12");
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    fireEvent.keyDown(menu, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("keeps a single profile inside the mobile drawer and closes it when the drawer closes", () => {
    renderPanel(panel);
    const sidebar = screen.getByRole("complementary");
    expect(sidebar.className).toContain("invisible");
    fireEvent.click(screen.getByRole("button", { name: "نمایش منو" }));
    expect(sidebar.className).not.toContain("invisible");
    const trigger = within(sidebar).getByRole("button", { name: /منوی کاربر سارا/ });
    expect(trigger.className).toContain("min-h-11");
    fireEvent.click(trigger);
    fireEvent.click(within(sidebar).getByRole("button", { name: "بستن منو" }));
    expect(screen.queryByRole("menu")).toBeNull();
    expect(sidebar.className).toContain("invisible");
    expect(screen.getAllByRole("button", { name: /منوی کاربر سارا/ })).toHaveLength(1);
  });

  it("preserves keyboard navigation, workspace destinations, account settings and logout", () => {
    renderPanel(panel);
    const trigger = screen.getByRole("button", { name: /منوی کاربر سارا/ });
    fireEvent.click(trigger);
    const menu = screen.getByRole("menu");
    expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "محیط مهمان" }));
    fireEvent.keyDown(menu, { key: "End" });
    expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "خروج" }));
    fireEvent.keyDown(menu, { key: "Home" });
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "پنل اقامتگاه‌ها" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "پنل مدیریت" }));
    expect(mocks.push).toHaveBeenCalledWith("/admin");
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("menuitem", { name: "تنظیمات حساب" }));
    expect(screen.getByRole("dialog", { name: "تنظیمات حساب" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "بستن تنظیمات" }));
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("menuitem", { name: "خروج" }));
    expect(mocks.clearSession).toHaveBeenCalledTimes(1);
    expect(mocks.push).toHaveBeenCalledWith("/login");
  });

  it("closes on outside pointers and Tab, and preserves theme controls", () => {
    renderPanel(panel);
    const trigger = screen.getByRole("button", { name: /منوی کاربر سارا/ });
    fireEvent.click(trigger);
    fireEvent.pointerDown(screen.getByText("محتوای صفحه"));
    expect(screen.queryByRole("menu")).toBeNull();
    fireEvent.click(trigger);
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Tab" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(trigger);
    fireEvent.click(screen.getByRole("button", { name: "تغییر حالت روشن و تیره" }));
    expect(trigger.closest(".dark")).toBeTruthy();
    fireEvent.click(trigger);
    expect(screen.getByRole("menu").className).toContain("bg-popover");
    fireEvent.click(screen.getByRole("button", { name: "اعلان‌ها" }));
    expect(screen.queryByRole("menu")).toBeNull();
  });
});

it("keeps public profile placement and trigger styling unchanged", () => {
  render(<KoochUserMenu />);
  const trigger = screen.getByRole("button", { name: /منوی کاربر سارا/ });
  expect(trigger.className).toContain("max-w-56");
  expect(trigger.closest("footer")).toBeNull();
  fireEvent.click(trigger);
  expect(screen.getByRole("menu").className).toContain("top-12");
  expect(screen.getByRole("button", { name: "بستن منوی کاربر" })).toBeTruthy();
});

it("shares Admin and Owner header appearance and interactive states without changing their canvases", () => {
  function captureHeader(panel: "admin" | "owner") {
    const view = renderPanel(panel);
    const search = screen.getByPlaceholderText("جستجو در اقامتگاه، رزرو، کاربر...");
    const header = search.closest("header")!;
    const shell = header.parentElement!.parentElement!.parentElement!;
    const sidebar = screen.getByRole("complementary");
    const initialSidebarClasses = sidebar.className;
    const styles = () => ({
      header: header.className,
      layout: header.firstElementChild?.className,
      search: search.className,
      searchContainer: search.parentElement?.className,
      controls: within(header).getAllByRole("button").map((button) => button.className),
    });
    expect(header.className).toContain("bg-transparent");
    expect(header.className).not.toContain("border-b");
    expect(shell.className).toContain(panel === "admin" ? "bg-background" : "bg-slate-100");
    expect(within(header).queryByRole("button", { name: /منوی کاربر/ })).toBeNull();
    const light = styles();
    fireEvent.change(search, { target: { value: "رزرو" } });
    expect((search as HTMLInputElement).value).toBe("رزرو");
    fireEvent.click(within(header).getByRole("button", { name: "پیام‌ها" }));
    const activeMessages = within(header).getByRole("button", { name: "پیام‌ها" }).className;
    fireEvent.click(within(header).getByRole("button", { name: "پیام‌ها" }));
    expect(sidebar.className).toBe(initialSidebarClasses);
    fireEvent.click(within(header).getByRole("button", { name: "تغییر حالت روشن و تیره" }));
    expect(shell.className).toContain("dark");
    const dark = styles();
    expect(header.className).toBe(light.header);
    view.unmount();
    return { light, dark, activeMessages };
  }
  expect(captureHeader("owner")).toEqual(captureHeader("admin"));
});
