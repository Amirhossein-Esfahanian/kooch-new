import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
  SharedUploader: ({ extraFormFields }: { extraFormFields?: { key?: string } }) => (
    <div>{`uploader-${extraFormFields?.key}`}</div>
  ),
}));
vi.mock("@/lib/owner-api", () => ({
  apiRequest: ownerApi.request,
  getToken: () => null,
}));

import AdminSiteSettingsPage from "@/app/admin/site-settings/page";

const standardSettings = [
  setting(1, "site.name", "کوچ", "Text", "Brand", "نام سایت"),
  setting(2, "site.logoUrl", "/logo.svg", "ImageUrl", "Brand", "آدرس لوگو"),
  setting(3, "site.footerText", "متن فوتر", "Text", "Footer", "متن فوتر"),
  setting(4, "home.heroTitle", "عنوان نخست", "Text", "Homepage", "عنوان هیرو"),
  setting(5, "home.heroSubtitle", "زیرعنوان نخست", "LongText", "Homepage", "زیرعنوان هیرو"),
  setting(6, "home.heroBackgroundUrl", "/hero.jpg", "ImageUrl", "Homepage", "تصویر هیرو"),
  setting(7, "home.searchButtonText", "جستجو", "Text", "Homepage", "متن جستجو"),
  setting(8, "home.popularSectionTitle", "محبوب‌ها", "Text", "Homepage", "عنوان محبوب"),
  setting(9, "home.popularSectionSubtitle", "منتخب‌ها", "LongText", "Homepage", "زیرعنوان محبوب"),
  setting(10, "image.maxFileSizeMb", "2", "Number", "Images", "حداکثر حجم"),
  setting(11, "image.minWidth", "800", "Number", "Images", "حداقل عرض"),
  setting(12, "image.minHeight", "600", "Number", "Images", "حداقل ارتفاع"),
  setting(13, "image.maxImagesPerProperty", "30", "Number", "Images", "حداکثر تصاویر"),
  setting(14, "image.enableWebpConversion", "true", "Boolean", "Images", "تبدیل WebP"),
  setting(15, "pricing.currencyLabel", "تومان", "Text", "Pricing", "واحد پول"),
  setting(16, "site.defaultSeoTitle", "عنوان سئو", "Text", "SEO", "عنوان پیش‌فرض سئو"),
  setting(17, "site.defaultSeoDescription", "توضیح سئو", "LongText", "SEO", "توضیحات پیش‌فرض سئو"),
  setting(18, "ReservationCommissionPercent", "5", "Number", "Reservation", "درصد کمیسیون رزرو"),
  setting(19, "ReferralCommissionPercent", "3", "Number", "Reservation", "درصد کمیسیون معرفی"),
  setting(20, "CommissionType3Percent", "2", "Number", "Reservation", "درصد کمیسیون نوع سوم"),
];

describe("Admin Site Settings information architecture", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });
  beforeEach(() => {
    ownerApi.request.mockReset();
    notifications.error.mockReset();
    notifications.success.mockReset();
    ownerApi.request.mockImplementation(
      async (path: string, options?: { method?: string; body?: string }) => {
        if (path === "/admin/site-settings/pricing-bounds") {
          return { minPrice: 100, maxPrice: 1000 };
        }
        if (path === "/admin/site-settings") return standardSettings;

        const key = decodeURIComponent(path.split("/").at(-1) ?? "");
        return {
          ...standardSettings.find((item) => item.key === key),
          value: JSON.parse(options?.body ?? "{}").value,
        };
      },
    );
  });

  it("renders the six stable sections and anchor navigation without unmounting fields", async () => {
    render(<AdminSiteSettingsPage />);

    await screen.findByDisplayValue("کوچ");
    const expectedSections = [
      ["هویت و برند", "identity-and-brand"],
      ["صفحه اصلی", "homepage"],
      ["تصاویر و بارگذاری", "images-and-uploads"],
      ["قیمت‌گذاری و نمایش مبلغ", "pricing-and-currency"],
      ["سئو", "seo"],
      ["کمیسیون‌ها", "commissions"],
    ] as const;

    expect(screen.getAllByRole("heading", { level: 2 })).toHaveLength(6);
    const navigation = screen.getByRole("navigation", {
      name: "بخش‌های تنظیمات سایت",
    });
    for (const [title, id] of expectedSections) {
      expect(screen.getByRole("heading", { level: 2, name: title })).toBeTruthy();
      expect(
        within(navigation).getByRole("link", { name: title }).getAttribute("href"),
      ).toBe(`#${id}`);
    }

    fireEvent.click(within(navigation).getByRole("link", { name: "سئو" }));
    expect(screen.getByDisplayValue("کوچ")).toBeTruthy();
    expect(screen.getByDisplayValue("تومان")).toBeTruthy();
  });

  it("keeps the section navigation contained normally and expands its surface when sticky", async () => {
    const rectSpy = vi
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockReturnValue({
        bottom: 101,
        height: 1,
        left: 0,
        right: 100,
        top: 100,
        width: 100,
        x: 0,
        y: 100,
        toJSON: () => ({}),
      });

    render(<AdminSiteSettingsPage />);
    await screen.findByDisplayValue("کوچ");

    const navigation = screen.getByRole("navigation", {
      name: "بخش‌های تنظیمات سایت",
    });
    const linksSurface = navigation.firstElementChild?.firstElementChild;
    expect(navigation.className).toContain("sticky top-0");
    expect(navigation.className).toContain("bg-transparent");
    expect(linksSurface?.className).toContain("rounded-lg");
    expect(linksSurface?.className).toContain("bg-card");
    expect(linksSurface?.className).toContain("flex-nowrap");
    expect(linksSurface?.className).toContain("overflow-x-auto");

    const sentinel = navigation.previousElementSibling?.lastElementChild;
    expect(sentinel).toBeTruthy();
    vi.spyOn(sentinel as HTMLElement, "getBoundingClientRect").mockReturnValue({
      bottom: 0,
      height: 1,
      left: 0,
      right: 100,
      top: -1,
      width: 100,
      x: 0,
      y: -1,
      toJSON: () => ({}),
    });
    fireEvent.scroll(window);

    await waitFor(() => {
      expect(navigation.className).toContain("bg-card");
      expect(navigation.className).not.toContain("bg-transparent");
      expect(linksSurface?.className).toContain("rounded-none");
    });

    rectSpy.mockRestore();
  });

  it("marks the active section and respects reduced motion for anchor navigation", async () => {
    const originalMatchMedia = window.matchMedia;
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn(() => ({ matches: true })),
    });

    render(<AdminSiteSettingsPage />);
    await screen.findByDisplayValue("کوچ");

    const navigation = screen.getByRole("navigation", {
      name: "بخش‌های تنظیمات سایت",
    });
    const seoSection = document.getElementById("seo");
    const scrollIntoView = vi.fn();
    Object.defineProperty(seoSection, "scrollIntoView", {
      configurable: true,
      value: scrollIntoView,
    });

    const seoLink = within(navigation).getByRole("link", { name: "سئو" });
    fireEvent.click(seoLink);

    expect(seoLink.getAttribute("aria-current")).toBe("location");
    expect(scrollIntoView).toHaveBeenCalledWith({
      behavior: "auto",
      block: "start",
    });

    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: originalMatchMedia,
    });
  });

  it("holds the newest clicked section during scroll and releases at arrival or user interruption", async () => {
    render(
      <div data-testid="scroll-root" style={{ overflowY: "auto" }}>
        <AdminSiteSettingsPage />
      </div>,
    );
    await screen.findByDisplayValue("کوچ");
    const root = screen.getByTestId("scroll-root");
    const navigation = screen.getByRole("navigation", { name: "بخش‌های تنظیمات سایت" });
    const links = within(navigation).getAllByRole("link");
    const rect = (top: number, height = 46) => ({
      top, bottom: top + height, height, left: 0, right: 800,
      width: 800, x: 0, y: top, toJSON: () => ({}),
    });
    vi.spyOn(root, "getBoundingClientRect").mockImplementation(() => rect(80, 600));
    vi.spyOn(navigation, "getBoundingClientRect").mockImplementation(() => rect(80));
    Object.defineProperties(root, {
      scrollHeight: { configurable: true, value: 2600 },
      clientHeight: { configurable: true, value: 600 },
    });
    let reduced = false;
    vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: reduced })));
    const scrollIntoView = vi.fn();
    links.forEach((link, index) => {
      const target = document.querySelector(link.getAttribute("href")!) as HTMLElement;
      vi.spyOn(target, "getBoundingClientRect").mockImplementation(
        () => rect(80 + 200 + index * 300 - root.scrollTop, 280),
      );
      Object.defineProperty(target, "scrollIntoView", { configurable: true, value: scrollIntoView });
    });
    const scrollTo = (top: number) => {
      root.scrollTop = top;
      fireEvent.scroll(root);
    };
    const expectActive = (index: number) => {
      expect(links[index].getAttribute("aria-current")).toBe("location");
      expect(links.filter(link => link.hasAttribute("aria-current"))).toHaveLength(1);
    };

    fireEvent.click(links[1]);
    expectActive(1);
    scrollTo(250);
    expectActive(1);
    scrollTo(446);
    expectActive(1);
    scrollTo(747);
    expectActive(2);

    fireEvent.click(links[5]);
    for (const top of [850, 1050, 1350, 1646]) {
      scrollTo(top);
      expectActive(5);
    }
    scrollTo(1346);
    expectActive(4);

    fireEvent.click(links[0]);
    for (const top of [1100, 700, 350, 146]) {
      scrollTo(top);
      expectActive(0);
    }
    scrollTo(447);
    expectActive(1);

    fireEvent.click(links[5]);
    scrollTo(750);
    fireEvent.click(links[3]);
    scrollTo(900);
    expectActive(3);
    scrollTo(1046);
    expectActive(3);
    scrollTo(1347);
    expectActive(4);

    fireEvent.click(links[0]);
    fireEvent.wheel(root);
    expectActive(4);
    fireEvent.click(links[0]);
    fireEvent.touchMove(root);
    expectActive(4);

    reduced = true;
    fireEvent.click(links[2]);
    expect(scrollIntoView).toHaveBeenLastCalledWith({ behavior: "auto", block: "start" });
    scrollTo(746);
    expectActive(2);
    scrollTo(1047);
    expectActive(3);

    Object.defineProperty(root, "scrollHeight", { configurable: true, value: 2000 });
    fireEvent.click(links[5]);
    scrollTo(1400);
    expectActive(5);
    scrollTo(1300);
    expectActive(3);
  });

  it("places exact known settings in their user-facing sections", async () => {
    render(<AdminSiteSettingsPage />);
    await screen.findByDisplayValue("کوچ");

    const identity = section("identity-and-brand");
    expect(within(identity).getByText("نام سایت")).toBeTruthy();
    expect(within(identity).getByText("متن فوتر")).toBeTruthy();

    const homepage = section("homepage");
    expect(within(homepage).getByText("عنوان هیرو")).toBeTruthy();
    expect(within(homepage).getByText("uploader-home.heroBackgroundUrl")).toBeTruthy();

    const images = section("images-and-uploads");
    expect(within(images).getByText("حداکثر حجم")).toBeTruthy();
    expect(within(images).getByText("تبدیل WebP")).toBeTruthy();

    const pricing = section("pricing-and-currency");
    expect(within(pricing).getByText("محدوده قیمت روزانه")).toBeTruthy();
    expect(within(pricing).getByText("واحد پول")).toBeTruthy();

    const seo = section("seo");
    expect(within(seo).getByText("عنوان پیش‌فرض سئو")).toBeTruthy();
    expect(within(seo).getByText("توضیحات پیش‌فرض سئو")).toBeTruthy();
  });

  it("hides technical keys and keeps commissions editable with product labels", async () => {
    render(<AdminSiteSettingsPage />);
    await screen.findByDisplayValue("5");

    for (const technicalKey of [
      "site.name",
      "home.heroTitle",
      "pricing.currencyLabel",
      "ReservationCommissionPercent",
    ]) {
      expect(screen.queryByText(technicalKey)).toBeNull();
    }

    const commissions = section("commissions");
    expect(within(commissions).getByText("کمیسیون رزرو عادی")).toBeTruthy();
    expect(within(commissions).getByText("کمیسیون رزرو از لینک پذیرش")).toBeTruthy();
    expect(
      within(commissions).getByText("کمیسیون رزرو از لینک اختصاصی اقامتگاه"),
    ).toBeTruthy();
    expect(
      within(commissions).getByText(/در حال حاضر در محاسبات رزروهای فعال اعمال نمی‌شوند/),
    ).toBeTruthy();

    fireEvent.change(within(commissions).getByDisplayValue("5"), {
      target: { value: "6" },
    });
    fireEvent.click(within(commissions).getAllByRole("button", { name: "ذخیره" })[0]);

    await waitFor(() =>
      expect(ownerApi.request).toHaveBeenCalledWith(
        "/admin/site-settings/ReservationCommissionPercent",
        { method: "PUT", body: JSON.stringify({ value: "6" }) },
      ),
    );
  });

  it("keeps an unknown generic setting visible in the fallback section", async () => {
    ownerApi.request.mockImplementation(async (path: string) => {
      if (path === "/admin/site-settings/pricing-bounds") {
        return { minPrice: 100, maxPrice: 1000 };
      }
      return [
        ...standardSettings,
        setting(21, "future.setting", "فعال", "Text", "Future", "تنظیم آزمایشی آینده"),
      ];
    });

    render(<AdminSiteSettingsPage />);

    const fallbackTitle = await screen.findByRole("heading", {
      level: 2,
      name: "سایر تنظیمات",
    });
    const fallback = fallbackTitle.closest("section");
    expect(fallback).toBeTruthy();
    expect(within(fallback as HTMLElement).getByText("تنظیم آزمایشی آینده")).toBeTruthy();
    expect(screen.queryByText("future.setting")).toBeNull();
    expect(
      within(screen.getByRole("navigation", { name: "بخش‌های تنظیمات سایت" })).queryByRole(
        "link",
        { name: "سایر تنظیمات" },
      ),
    ).toBeNull();
  });
});

function section(id: string) {
  const element = document.getElementById(id);
  expect(element).toBeTruthy();
  return element as HTMLElement;
}

function setting(
  id: number,
  key: string,
  value: string,
  type: "Text" | "LongText" | "ImageUrl" | "Boolean" | "Number",
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
