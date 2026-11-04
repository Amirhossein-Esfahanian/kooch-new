import type { ReactNode } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  propertyId: "17",
  canViewBookings: true,
  canViewRooms: true,
  canViewPricing: true,
  canViewInventory: true,
  canViewProperty: true,
  routePropertyIsValid: true,
  apiRequest: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: mocks.propertyId }),
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock("@/components/auth/AuthSessionProvider", () => ({
  useAuthSession: () => ({ authenticated: true, loading: false, workspaces: ["owner"] }),
}));
vi.mock("@/components/dashboard/DashboardLayouts", () => ({
  OwnerLayout: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock("@/components/owner/OwnerPropertyProvider", () => ({
  useOwnerProperty: () => ({
    routePropertyIsValid: mocks.routePropertyIsValid,
    effectivePermissions: {
      Bookings: { view: mocks.canViewBookings },
      Rooms: { view: mocks.canViewRooms },
      Pricing: { view: mocks.canViewPricing },
      Inventory: { view: mocks.canViewInventory },
      Properties: { view: mocks.canViewProperty },
    },
  }),
}));
vi.mock("@/components/property/PropertyCompletionCard", () => ({
  PropertyCompletionCard: () => <div>وضعیت تکمیل اقامتگاه</div>,
}));
vi.mock("@/lib/owner-api", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/owner-api")>(),
  apiRequest: (...args: unknown[]) => mocks.apiRequest(...args),
}));

import OwnerPropertyDashboardPage from "@/app/owner/properties/[id]/dashboard/page";
import { ApiRequestError } from "@/lib/owner-api";

const summary = {
  businessDate: "2026-10-21",
  pendingApprovalCount: 2,
  scheduledArrivalsTodayCount: 0,
  scheduledDeparturesTodayCount: 5,
};

function setupRequests() {
  mocks.apiRequest.mockImplementation((path: string) => {
    if (path.endsWith("/reservations/operational-summary")) return Promise.resolve(summary);
    if (path.endsWith("/completion")) return Promise.resolve({ completionPercentage: 100, sections: [] });
    if (path.endsWith("/room-types")) return Promise.resolve([]);
    return Promise.resolve({ id: Number(mocks.propertyId), name: "خانه سرو", slug: "cedar", status: "Approved", city: "کاشان" });
  });
}

describe("Owner Property operational dashboard summary", () => {
  afterEach(() => vi.unstubAllEnvs());
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.propertyId = "17";
    mocks.canViewBookings = true;
    mocks.canViewRooms = true;
    mocks.canViewPricing = true;
    mocks.canViewInventory = true;
    mocks.canViewProperty = true;
    mocks.routePropertyIsValid = true;
    setupRequests();
  });

  it("shows four equal operational cards, a real zero, and the API business date", async () => {
    render(<OwnerPropertyDashboardPage />);
    const section = await screen.findByRole("region", { name: "وضعیت رزروهای اقامتگاه" });
    expect(mocks.apiRequest).toHaveBeenCalledWith(
      "/owner/properties/17/reservations/operational-summary",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(within(section).getByText("۲")).toBeTruthy();
    expect(within(section).getAllByText("۰")).toHaveLength(2);
    expect(within(section).getByText("۵")).toBeTruthy();
    expect(within(section).getByText("ورودهای امروز")).toBeTruthy();
    expect(within(section).getByText("خروج‌های امروز")).toBeTruthy();
    expect(within(section).getByText("انواع اتاق فعال")).toBeTruthy();
    expect(within(section).getByText(/برنامه رزروها، در تاریخ تهران/)).toBeTruthy();
    expect(within(section).getByText(/۱۴۰۵/)).toBeTruthy();
    const cards = within(section).getByText("در انتظار تأیید").parentElement?.parentElement;
    expect(cards?.className).toContain("sm:grid-cols-2");
    expect(cards?.className).toContain("lg:grid-cols-4");
    expect(cards?.children).toHaveLength(4);
    Array.from(cards?.children ?? []).forEach((card) => {
      expect(card.className).toContain("min-h-40");
      expect(card.className).toContain("text-center");
      expect(card.lastElementChild?.className).toContain("text-4xl");
    });
    expect(screen.queryByRole("region", { name: "تکمیل و راه‌اندازی اقامتگاه" })).toBeNull();
    expect(screen.getByText("کارهای سریع")).toBeTruthy();
  });

  it("places the public booking link immediately after quick actions using authorized Property data", async () => {
    vi.stubEnv("NEXT_PUBLIC_KOOCH_PUBLIC_ORIGIN", "https://public.example.test/");
    render(<OwnerPropertyDashboardPage />);
    const card = await screen.findByRole("region", { name: "لینک رزرو عمومی" });
    await screen.findByRole("textbox", { name: "نشانی صفحه رزرو عمومی" });
    expect(screen.getByRole("region", { name: "کارهای سریع" }).nextElementSibling).toBe(card);
    expect((screen.getByRole("textbox", { name: "نشانی صفحه رزرو عمومی" }) as HTMLInputElement).value).toBe("https://public.example.test/book/cedar");
  });

  it.each(["membership", "permission"])("does not expose sharing without Property %s access", async (boundary) => {
    vi.stubEnv("NEXT_PUBLIC_KOOCH_PUBLIC_ORIGIN", "https://public.example.test");
    if (boundary === "membership") mocks.routePropertyIsValid = false;
    else mocks.canViewProperty = false;
    render(<OwnerPropertyDashboardPage />);
    const card = screen.getByRole("region", { name: "لینک رزرو عمومی" });
    expect(within(card).getByRole("status").textContent).toContain("دسترسی به اطلاعات این اقامتگاه ندارید");
    expect(within(card).queryByRole("textbox")).toBeNull();
    if (boundary === "membership") expect(mocks.apiRequest).not.toHaveBeenCalled();
    else await screen.findByRole("heading", { name: "خانه سرو" });
  });

  it("removes the old sharing URL immediately when switching Properties", async () => {
    vi.stubEnv("NEXT_PUBLIC_KOOCH_PUBLIC_ORIGIN", "https://public.example.test");
    const { rerender } = render(<OwnerPropertyDashboardPage />);
    await screen.findByRole("textbox", { name: "نشانی صفحه رزرو عمومی" });
    mocks.propertyId = "18";
    mocks.apiRequest.mockImplementation(() => new Promise(() => undefined));
    rerender(<OwnerPropertyDashboardPage />);
    expect(screen.queryByRole("textbox", { name: "نشانی صفحه رزرو عمومی" })).toBeNull();
    expect(screen.queryByRole("button", { name: "کپی لینک" })).toBeNull();
  });

  it("shows only active RoomTypes and existing permission-gated quick actions", async () => {
    mocks.apiRequest.mockImplementation((path: string) => {
      if (path.endsWith("/reservations/operational-summary")) return Promise.resolve(summary);
      if (path.endsWith("/completion")) return Promise.resolve({ completionPercentage: 100, sections: [] });
      if (path.endsWith("/room-types")) return Promise.resolve([
        { id: 1, isActive: true }, { id: 2, isActive: false }, { id: 3, isActive: true },
      ]);
      return Promise.resolve({ id: 17, name: "خانه سرو", slug: "cedar", status: "Approved", city: "کاشان" });
    });
    render(<OwnerPropertyDashboardPage />);
    expect(within(await screen.findByRole("region", { name: "وضعیت رزروهای اقامتگاه" })).getByText("انواع اتاق فعال").nextElementSibling?.textContent).toBe("۲");
    expect(screen.getByRole("heading", { name: "خانه سرو" })).toBeTruthy();
    expect(screen.getByText(/وضعیت: تأیید شده/)).toBeTruthy();
    expect(screen.getByRole("link", { name: /قیمت‌گذاری/ }).getAttribute("href")).toBe("/owner/properties/17/pricing");
    expect(screen.getByRole("link", { name: /ظرفیت و موجودی/ }).getAttribute("href")).toBe("/owner/properties/17/inventory");
    expect(screen.getByRole("link", { name: /رزروها/ }).getAttribute("href")).toBe("/owner/properties/17/reservations");
    expect(within(screen.getByRole("region", { name: "کارهای سریع" })).getByRole("link", { name: /^اتاق‌ها مدیریت نوع اتاق‌ها$/ }).getAttribute("href")).toBe("/owner/properties/17/rooms");
    expect(screen.queryByText(/فروش امروز|اتاق فروخته‌شده|ظرفیت قابل فروش/)).toBeNull();
    expect(document.querySelector("main")?.getAttribute("dir")).toBe("rtl");
    expect(screen.getByRole("region", { name: "کارهای سریع" }).querySelector(".sm\\:grid-cols-2")).toBeTruthy();
    within(screen.getByRole("region", { name: "کارهای سریع" })).getAllByRole("link").forEach((link) => {
      expect(link.querySelector("section")).toBeNull();
      expect(link.className).toContain("min-h-14");
      expect(link.className).toContain("focus-visible:ring-2");
      expect(link.querySelector('[aria-hidden="true"]')).toBeTruthy();
    });
  });

  it("omits unauthorized metrics and quick actions rather than displaying zero", async () => {
    mocks.canViewBookings = false;
    mocks.canViewRooms = false;
    mocks.canViewPricing = false;
    mocks.canViewInventory = false;
    render(<OwnerPropertyDashboardPage />);
    await screen.findByRole("heading", { name: "خانه سرو" });
    expect(screen.queryByRole("region", { name: "وضعیت رزروهای اقامتگاه" })).toBeNull();
    expect(screen.queryByText("انواع اتاق فعال")).toBeNull();
    expect(screen.queryByRole("region", { name: "کارهای سریع" })).toBeNull();
    expect(screen.queryByRole("region", { name: "تکمیل و راه‌اندازی اقامتگاه" })).toBeNull();
  });

  it("keeps overview errors distinct and retries without fabricated RoomType counts", async () => {
    mocks.apiRequest.mockImplementation((path: string) =>
      path.endsWith("/completion") ? Promise.reject(new Error("offline"))
        : path.endsWith("/reservations/operational-summary") ? Promise.resolve(summary)
        : path.endsWith("/room-types") ? Promise.resolve([])
        : Promise.resolve({ id: 17, name: "خانه سرو" }),
    );
    render(<OwnerPropertyDashboardPage />);
    expect(await screen.findByText("دریافت اطلاعات اقامتگاه انجام نشد")).toBeTruthy();
    expect(screen.queryByText("انواع اتاق فعال")).toBeNull();
    expect(within(screen.getByRole("region", { name: "وضعیت رزروهای اقامتگاه" })).getByText("۵")).toBeTruthy();
    setupRequests();
    fireEvent.click(screen.getByRole("button", { name: "تلاش دوباره" }));
    expect(within(await screen.findByRole("region", { name: "وضعیت رزروهای اقامتگاه" })).getByText("انواع اتاق فعال").nextElementSibling?.textContent).toBe("۰");
  });

  it("shows loading without fabricated zero counts", async () => {
    mocks.apiRequest.mockImplementation((path: string) =>
      path.endsWith("/reservations/operational-summary")
        ? new Promise(() => undefined)
        : path.endsWith("/completion") ? Promise.resolve({ completionPercentage: 100, sections: [] })
        : path.endsWith("/room-types") ? Promise.resolve([])
        : Promise.resolve({ id: 17, name: "خانه سرو" }),
    );
    render(<OwnerPropertyDashboardPage />);
    const section = screen.getByRole("region", { name: "وضعیت رزروهای اقامتگاه" });
    expect(within(section).getByRole("status").textContent).toContain("در حال دریافت");
    expect(within(section).queryByText("۰")).toBeNull();
  });

  it("hides the section and makes no request without bookings.view", async () => {
    mocks.canViewBookings = false;
    mocks.canViewRooms = false;
    render(<OwnerPropertyDashboardPage />);
    await waitFor(() => expect(screen.getByRole("heading", { name: "خانه سرو" })).toBeTruthy());
    expect(screen.queryByRole("region", { name: "وضعیت رزروهای اقامتگاه" })).toBeNull();
    expect(mocks.apiRequest.mock.calls.some(([path]) => String(path).includes("operational-summary"))).toBe(false);
  });

  it("isolates a summary error and retries without affecting setup widgets", async () => {
    mocks.apiRequest.mockImplementation((path: string) =>
      path.endsWith("/reservations/operational-summary")
        ? Promise.reject(new Error("offline"))
        : path.endsWith("/completion") ? Promise.resolve({ completionPercentage: 100, sections: [] })
        : path.endsWith("/room-types") ? Promise.resolve([])
        : Promise.resolve({ id: 17, name: "خانه سرو" }),
    );
    render(<OwnerPropertyDashboardPage />);
    const section = await screen.findByRole("region", { name: "وضعیت رزروهای اقامتگاه" });
    expect(await within(section).findByRole("alert")).toBeTruthy();
    expect(screen.queryByRole("region", { name: "تکمیل و راه‌اندازی اقامتگاه" })).toBeNull();
    setupRequests();
    fireEvent.click(within(section).getByRole("button", { name: "تلاش دوباره" }));
    expect(await within(section).findByText("۵")).toBeTruthy();
  });

  it("shows a distinct 403 state without retry or fabricated counts", async () => {
    mocks.apiRequest.mockImplementation((path: string) =>
      path.endsWith("/reservations/operational-summary")
        ? Promise.reject(new ApiRequestError("Forbidden", 403))
        : path.endsWith("/completion") ? Promise.resolve({ completionPercentage: 100, sections: [] })
        : path.endsWith("/room-types") ? Promise.resolve([])
        : Promise.resolve({ id: 17, name: "خانه سرو" }),
    );
    render(<OwnerPropertyDashboardPage />);
    const section = await screen.findByRole("region", { name: "وضعیت رزروهای اقامتگاه" });
    expect(await within(section).findByText("دسترسی به خلاصه رزروها ندارید")).toBeTruthy();
    expect(within(section).queryByRole("button", { name: "تلاش دوباره" })).toBeNull();
    expect(screen.queryByRole("region", { name: "تکمیل و راه‌اندازی اقامتگاه" })).toBeNull();
  });

  it("discards an old Property response after switching PropertyId", async () => {
    let resolveOld!: (value: typeof summary) => void;
    mocks.apiRequest.mockImplementation((path: string) => {
      if (path.includes("/properties/17/reservations/operational-summary")) {
        return new Promise((resolve) => { resolveOld = resolve; });
      }
      if (path.endsWith("/reservations/operational-summary")) {
        return Promise.resolve({ ...summary, pendingApprovalCount: 9 });
      }
      if (path.endsWith("/completion")) return Promise.resolve({ completionPercentage: 100, sections: [] });
      if (path.endsWith("/room-types")) return Promise.resolve([]);
      return Promise.resolve({ id: Number(mocks.propertyId), name: "خانه سرو" });
    });
    const view = render(<OwnerPropertyDashboardPage />);
    await waitFor(() => expect(resolveOld).toBeTypeOf("function"));
    mocks.propertyId = "22";
    view.rerender(<OwnerPropertyDashboardPage />);
    const section = screen.getByRole("region", { name: "وضعیت رزروهای اقامتگاه" });
    expect(await within(section).findByText("۹")).toBeTruthy();
    resolveOld({ ...summary, pendingApprovalCount: 77 });
    await waitFor(() => expect(within(section).queryByText("۷۷")).toBeNull());
    expect(within(section).getByText("۹")).toBeTruthy();
  });
});
