import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { MarketplacePropertyDetail } from "@/components/property/marketplace/MarketplacePropertyDetail";
import styles from "@/components/property/marketplace/MarketplacePropertyDetail.module.css";
import type { PublicProperty } from "@/lib/public-properties";

vi.mock("@/components/property/PropertyLocationMap", async (original) => ({
  ...await original<typeof import("@/components/property/PropertyLocationMap")>(),
  PropertyLocationMap: () => <div data-testid="map-fixture">نقشهٔ آزمایشی</div>,
}));

function property(): PublicProperty {
  return {
    id: 7, name: "خانه باغ", englishName: "Garden House", slug: "garden", seoTitle: null, seoDescription: null,
    city: "کاشان", country: "IR", address: "خیابان باغ", description: "معرفی واقعی خانه باغ", shortDescription: "خانه باغ",
    coverImageUrl: "/photo-1.jpg", status: "Approved", propertyType: "TraditionalHouse", inventoryMode: "TypeBasedInventory",
    checkInTime: "14:00:00", checkOutTime: "12:00:00", regularReceptionFrom: null, regularReceptionUntil: null,
    latitude: 33.9, longitude: 51.4, hasElevator: false, isWheelchairAccessible: null, hasGroundFloorRoom: null,
    hasAccessibleBathroom: null, isInstantBooking: true, startingPrice: null, matchingRoomTypesCount: 0,
    matchingRoomTypes: [], guestFitStatus: "Unknown", availabilitySummary: "Unknown", availabilityStatusSummary: "Unknown",
    freeChildAgeLimit: null, maxFreeChildren: null, images: Array.from({ length: 6 }, (_, i) => ({ id: i + 1,
      url: `/photo-${i + 1}.jpg`, altText: `نمای شماره ${i + 1}`, caption: `توضیح تصویر ${i + 1}`, tag: null, isCover: i === 0 })),
    descriptionSections: [{ sectionType: "ImportantNotes", title: "نکات مهم", content: "یادداشت واقعی", sortOrder: 1 }],
    commonAreas: [], settings: [], amenities: [], nearbyPlaces: [], views: [], roomTypes: [],
  };
}

function Detail({ data = property() }: { data?: PublicProperty }) {
  return <MarketplacePropertyDetail property={data} resultsHref="/properties?city=کاشان"
    searchBar={<><div data-testid="search-fixture">کنترل‌های واقعی جستجو</div><div><p>تاریخ و تعداد مهمان را برای بررسی موجودی انتخاب کنید.</p></div></>}
    roomSelection={<div>انتخاب اتاق</div>} />;
}

let searchHeight = 120;
let reducedMotion = false;
let observers: ResizeObserverCallback[] = [];
const positions: Record<string, number> = {
  "property-overview": 750, "property-highlights": 1100, "property-facilities": 1500,
  "property-rooms": 2250, "property-reviews": 2700, "property-location": 3100, "property-policies": 3500,
};

beforeEach(() => {
  searchHeight = 120; reducedMotion = false; observers = [];
  window.history.replaceState(null, "", "/properties/garden");
  vi.stubGlobal("scrollY", 0);
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: reducedMotion })));
  vi.stubGlobal("ResizeObserver", class {
    constructor(callback: ResizeObserverCallback) { observers.push(callback); }
    observe() {} disconnect() {}
  });
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: vi.fn() });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    const height = this.classList.contains(styles.searchShell) ? searchHeight : this.tagName === "NAV" ? 56 : this.dataset.testid === "site-header" ? 64 : 0;
    const top = this.id in positions ? positions[this.id] - window.scrollY : this.classList.contains(styles.sectionNavigation) ? Math.max(650 - window.scrollY, searchHeight) : this.nextElementSibling?.tagName === "NAV" ? 650 - window.scrollY : 0;
    return { top, bottom: top + height, height, width: 1200, left: 0, right: 1200, x: 0, y: top, toJSON: () => ({}) };
  });
});

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("Marketplace property presentation", () => {
  it("keeps only Persian identity and the results link above five actual mosaic tiles", () => {
    render(<Detail />);
    const header = screen.getByRole("heading", { level: 1 }).closest("header")!;
    expect(header.textContent).toBe("خانه باغبازگشت به نتایج جست‌وجو");
    expect(within(header).queryByText("Garden House")).toBeNull();
    const gallery = screen.getByRole("region", { name: "تصاویر اقامتگاه" });
    expect(within(gallery).getAllByRole("img")).toHaveLength(5);
    const pill = within(gallery).getByRole("button", { name: "مشاهده همه تصاویر" });
    expect(pill.textContent).not.toMatch(/[0-9۰-۹]/);
    expect(pill.querySelector('svg[aria-hidden="true"]')).toBeTruthy();
    expect(screen.getByRole("link", { name: "بازگشت به نتایج جست‌وجو" }).getAttribute("href")).toContain("/properties?");
  });

  it("opens a read-only shared dialog, navigates all images and restores focus on Escape", async () => {
    render(<Detail />);
    const opener = screen.getByRole("button", { name: "مشاهده همه تصاویر" });
    opener.focus(); fireEvent.click(opener);
    const dialog = await screen.findByRole("dialog", { name: "تصاویر خانه باغ" });
    expect(within(dialog).getByRole("img", { name: "نمای شماره 1" })).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(within(dialog).getByRole("group", { name: "نمایش تصاویر اقامتگاه" })));
    fireEvent.keyDown(document.activeElement!, { key: "ArrowLeft" });
    expect(within(dialog).getByRole("img", { name: "نمای شماره 2" })).toBeTruthy();
    fireEvent.keyDown(document.activeElement!, { key: "ArrowRight" });
    fireEvent.click(within(dialog).getByRole("button", { name: "تصویر بعدی" }));
    expect(within(dialog).getByRole("img", { name: "نمای شماره 2" })).toBeTruthy();
    fireEvent.keyDown(within(dialog).getByRole("button", { name: "تصویر بعدی" }), { key: "ArrowRight" });
    expect(within(dialog).getByRole("img", { name: "نمای شماره 1" })).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "انتخاب تصویر 6" }));
    expect(within(dialog).getByText("تصویر ۶ از ۶")).toBeTruthy();
    expect(within(dialog).getByText("توضیح تصویر 6")).toBeTruthy();
    expect(within(dialog).queryByText(/بارگذاری|برش|حذف/)).toBeNull();
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(opener));
  });

  it("handles empty imagery and missing review, policy and weather data honestly", () => {
    render(<Detail data={{ ...property(), images: [], latitude: null, longitude: null }} />);
    expect(screen.getByRole("button", { name: "مشاهده همه تصاویر" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByText("تصویری برای این اقامتگاه ثبت نشده است.")).toBeTruthy();
    expect(screen.getByText("امتیاز قابل‌نمایشی در دسترس نیست.")).toBeTruthy();
    expect(screen.getByText("غیرزنده")).toBeTruthy();
    expect(screen.getByText(/اطلاعات زنده یا پیش‌بینی ارائه نمی‌شود/)).toBeTruthy();
    expect(screen.queryByTestId("map-fixture")).toBeNull();
    expect(document.getElementById("property-policies")!.textContent).toContain("جزئیات سیاست لغو در حال حاضر برای نمایش در دسترس نیست.");
    expect(document.getElementById("property-policies")!.textContent).not.toContain("یادداشت واقعی");
    expect(document.getElementById("property-overview")!.textContent).toContain("یادداشت واقعی");
    expect(document.body.textContent).not.toMatch(/°|۱۰ از ۱۰|لغو رایگان|رزرو آنی/);
  });

  it("disables previous and next navigation for a single real photo", async () => {
    const data = property(); data.images = data.images.slice(0, 1);
    render(<Detail data={data} />);
    fireEvent.click(screen.getByRole("button", { name: "مشاهده همه تصاویر" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("button", { name: "تصویر قبلی" }).hasAttribute("disabled")).toBe(true);
    expect(within(dialog).getByRole("button", { name: "تصویر بعدی" }).hasAttribute("disabled")).toBe(true);
  });

  it("keeps anchors keyboard-accessible, uses RTL arrows and honors reduced motion without changing query context", () => {
    window.history.replaceState(null, "", "/properties/garden?adults=4&childAges=4,9");
    render(<Detail />);
    const navigation = screen.getByRole("navigation", { name: "بخش‌های اقامتگاه" });
    const links = within(navigation).getAllByRole("link");
    expect(links).toHaveLength(7);
    links[0].focus(); fireEvent.keyDown(links[0], { key: "ArrowLeft" }); expect(document.activeElement).toBe(links[1]);
    fireEvent.keyDown(links[1], { key: "End" }); expect(document.activeElement).toBe(links[6]);
    fireEvent.click(links[6]);
    expect(links[6].getAttribute("aria-current")).toBe("location");
    expect(document.activeElement).toBe(document.getElementById("property-policies"));
    expect(HTMLElement.prototype.scrollIntoView).toHaveBeenLastCalledWith({ behavior: "smooth", block: "start" });
    expect(window.location.search).toBe("?adults=4&childAges=4,9");
    expect(window.location.hash).toBe("#property-policies");
    reducedMotion = true;
    fireEvent.click(links[0]);
    expect(HTMLElement.prototype.scrollIntoView).toHaveBeenLastCalledWith({ behavior: "auto", block: "start" });
    fireEvent.click(within(navigation).getByRole("button", { name: "بازگشت به بالا" }));
    expect(window.scrollTo).toHaveBeenCalledWith({ top: 0, behavior: "auto" });
    expect(document.activeElement).toBe(screen.getByRole("heading", { level: 1 }));
  });

  it.each([
    ["property-location", "موقعیت مکانی"],
    ["property-rooms", "اتاق‌ها"],
  ])("restores the initial %s fragment after content mounts without discarding search parameters", (id, label) => {
    window.history.replaceState(null, "", `/properties/garden?adults=3#${id}`);
    render(<Detail />);
    const navigation = screen.getByRole("navigation", { name: "بخش‌های اقامتگاه" });
    expect(within(navigation).getByRole("link", { name: label }).getAttribute("aria-current")).toBe("location");
    expect(HTMLElement.prototype.scrollIntoView).toHaveBeenCalledWith({ behavior: "auto", block: "start" });
    expect(window.location.search).toBe("?adults=3");
  });

  it("hides only the current public shell header, tracks scrolling, measures offsets and cleans up on exit", async () => {
    const view = render(<div><header data-testid="site-header">هدر اصلی</header><main><Detail /></main></div>);
    const header = screen.getByTestId("site-header");
    const root = screen.getByRole("heading", { level: 1 }).closest(`.${styles.page}`)! as HTMLElement;
    const navigation = screen.getByRole("navigation", { name: "بخش‌های اقامتگاه" });
    expect(root.style.getPropertyValue("--marketplace-search-height")).toBe("120px");
    expect(header.classList.contains(styles.siteHeaderHidden)).toBe(false);
    vi.stubGlobal("scrollY", 1900); fireEvent.scroll(window);
    await waitFor(() => expect(root.getAttribute("data-header-collapsed")).toBe("true"));
    expect(header.classList.contains(styles.siteHeaderHidden)).toBe(true);
    expect(navigation.getAttribute("data-stuck")).toBe("true");
    expect(within(navigation).getByRole("link", { name: "امکانات" }).getAttribute("aria-current")).toBe("location");
    searchHeight = 240;
    act(() => observers.forEach((callback) => callback([], {} as ResizeObserver)));
    await waitFor(() => expect(root.style.getPropertyValue("--marketplace-search-height")).toBe("240px"));
    vi.stubGlobal("scrollY", 0); fireEvent.scroll(window);
    await waitFor(() => expect(root.getAttribute("data-header-collapsed")).toBe("false"));
    expect(navigation.getAttribute("data-stuck")).toBe("false");
    vi.stubGlobal("scrollY", 1900); fireEvent.scroll(window);
    await waitFor(() => expect(header.classList.contains(styles.siteHeaderHidden)).toBe(true));
    view.unmount(); expect(header.classList.contains(styles.siteHeaderHidden)).toBe(false);
  });

  it("keeps responsive, themed styles local and restores the full-width shared booking layout", () => {
    const css = readFileSync(resolve(process.cwd(), "components/property/marketplace/MarketplacePropertyDetail.module.css"), "utf8");
    expect(css).toContain('top: calc(var(--header-height) + var(--marketplace-search-height))');
    expect(css).toContain('border-bottom-color: var(--primary)');
    expect(css).toContain('grid-template-columns: minmax(0, 1fr) 300px; direction: ltr');
    expect(css).toContain('.fullWidth { grid-column: 1 / -1; }');
    expect(css).toContain('.sidebar { grid-column: 2; grid-row: 1; }');
    expect(css).toContain('.fullWidth { direction: rtl; }');
    expect(css).not.toMatch(/\.rooms \[data-testid="(?:room-selection-region|booking-choices-summary)"\]/);
    expect(css).toContain('grid-template-columns: repeat(3, minmax(0, 1fr))');
    expect(css).toContain('.searchShell > div:not(:first-child) > p { display: none; }');
    expect(css).toContain('prefers-reduced-motion: reduce');
    expect(css).not.toMatch(/:global|:root|#[a-f\d]{3,8}\b|100vw/);
    const direct = readFileSync(resolve(process.cwd(), "components/booking/PropertyBookingLanding.tsx"), "utf8");
    expect(direct).not.toContain("MarketplaceProperty");
  });

  it("shows actual identity, base description, introductions and important notes in About without duplicate descriptions", () => {
    const data = property();
    data.descriptionSections.push(
      { sectionType: "PropertyIntroduction", title: "معرفی", content: data.description, sortOrder: 0 },
      { sectionType: "PropertyIntroduction", title: "درباره بنا", content: "توضیح تکمیلی بنا", sortOrder: 2 },
    );
    render(<Detail data={data} />);
    const about = screen.getByRole("region", { name: "درباره اقامتگاه" });
    expect(within(about).getByText(data.name)).toBeTruthy();
    expect(screen.getAllByRole("heading", { name: data.name })).toHaveLength(1);
    expect(within(about).getByText(data.englishName!).getAttribute("dir")).toBe("ltr");
    expect(within(about).getByText("خانه سنتی")).toBeTruthy();
    expect(within(about).getAllByText(data.description)).toHaveLength(1);
    expect(within(about).getByText("توضیح تکمیلی بنا")).toBeTruthy();
    expect(within(about).getByText("یادداشت واقعی")).toBeTruthy();
    expect(screen.queryByText("اطلاعات سریع")).toBeNull();
  });

  it("keeps common areas and true/false accessibility data only in Highlights, not Facilities", () => {
    const data = property();
    data.commonAreas = [{ id: 1, name: "حیاط مشترک", description: "حیاطی برای مهمانان", sortOrder: 0 }];
    data.isWheelchairAccessible = true;
    data.amenities = [{ id: 1, name: "اینترنت", category: "خدمات" }];
    data.views = ["GardenView"];
    render(<Detail data={data} />);
    const highlights = screen.getByRole("region", { name: "ویژگی‌های برجسته" });
    expect(within(highlights).getByText("حیاط مشترک")).toBeTruthy();
    expect(within(highlights).getByText("حیاطی برای مهمانان")).toBeTruthy();
    expect(within(highlights).getByText("مناسب ویلچر").nextElementSibling?.textContent).toBe("دارد");
    expect(within(highlights).getByText("آسانسور").nextElementSibling?.textContent).toBe("ندارد");
    expect(within(highlights).queryByText("اتاق همکف")).toBeNull();
    expect(within(highlights).queryByText("ساعت ورود")).toBeNull();
    expect(within(highlights).queryByText("اینترنت")).toBeNull();
    expect(within(highlights).queryByText("چشم‌اندازها")).toBeNull();
    expect(within(screen.getByRole("region", { name: "موقعیت مکانی" })).getByText("نمای باغ")).toBeTruthy();
    const facilities = screen.getByRole("region", { name: "امکانات" });
    expect(within(facilities).getByText("اینترنت")).toBeTruthy();
    expect(within(facilities).queryByText("حیاط مشترک")).toBeNull();
    expect(within(facilities).queryByText("دسترسی‌پذیری")).toBeNull();
  });

  it("omits absent common areas and nullable accessibility fields without inventing data or an empty See all action", () => {
    render(<Detail />);
    const highlights = screen.getByRole("region", { name: "ویژگی‌های برجسته" });
    expect(within(highlights).queryByText("فضاهای مشترک")).toBeNull();
    expect(within(highlights).queryByText("مناسب ویلچر")).toBeNull();
    expect(within(highlights).getByText("آسانسور").nextElementSibling?.textContent).toBe("ندارد");
    expect(screen.getByText("هنوز امکاناتی ثبت نشده است.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "مشاهده همه" })).toBeNull();
  });

  it("previews six amenities with icons and opens all actual amenities in the shared read-only dialog", async () => {
    const data = property();
    data.amenities = Array.from({ length: 8 }, (_, index) => ({ id: index + 1, name: `امکان ${index + 1}`, category: index < 4 ? "عمومی" : "خدمات" }));
    render(<Detail data={data} />);
    const facilities = screen.getByRole("region", { name: "امکانات" });
    expect(within(facilities).getAllByRole("listitem")).toHaveLength(6);
    within(facilities).getAllByRole("listitem").forEach((item) => expect(item.querySelector('[aria-hidden="true"]')).toBeTruthy());
    expect(within(facilities).queryByText("امکان 7")).toBeNull();
    const opener = within(facilities).getByRole("button", { name: "مشاهده همه" });
    opener.focus(); fireEvent.click(opener);
    const dialog = await screen.findByRole("dialog", { name: "همه امکانات اقامتگاه" });
    expect(within(dialog).getAllByRole("listitem")).toHaveLength(8);
    expect(within(dialog).getByRole("heading", { name: "عمومی" })).toBeTruthy();
    expect(within(dialog).getByText("امکان 8")).toBeTruthy();
    expect(within(dialog).queryByRole("button", { name: /ویرایش|حذف/ })).toBeNull();
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(opener));
  });

  it("places Rooms after Facilities outside the sidebar-constrained main column and supports its anchor and tracking", async () => {
    render(<Detail />);
    const facilities = document.getElementById("property-facilities")!;
    const rooms = document.getElementById("property-rooms")!;
    expect(facilities.compareDocumentPosition(rooms) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(rooms.parentElement?.classList.contains(styles.contentGrid)).toBe(true);
    expect(rooms.classList.contains(styles.fullWidth)).toBe(true);
    const navigation = screen.getByRole("navigation", { name: "بخش‌های اقامتگاه" });
    const link = within(navigation).getByRole("link", { name: "اتاق‌ها" });
    expect(link.getAttribute("href")).toBe("#property-rooms");
    fireEvent.click(link);
    expect(document.activeElement).toBe(rooms);
    expect(window.location.hash).toBe("#property-rooms");
    expect(link.getAttribute("aria-current")).toBe("location");
    fireEvent.wheel(window);
    vi.stubGlobal("scrollY", 800); fireEvent.scroll(window);
    await waitFor(() => expect(within(navigation).getByRole("link", { name: "معرفی اقامتگاه" }).getAttribute("aria-current")).toBe("location"));
    vi.stubGlobal("scrollY", 2300); fireEvent.scroll(window);
    await waitFor(() => expect(link.getAttribute("aria-current")).toBe("location"));
  });

  it("does not hide a focused site-header control while the user scrolls", async () => {
    render(<div><header data-testid="site-header"><a href="/login">ورود به حساب</a></header><main><Detail /></main></div>);
    const header = screen.getByTestId("site-header");
    screen.getByRole("link", { name: "ورود به حساب" }).focus();
    vi.stubGlobal("scrollY", 1900); fireEvent.scroll(window);
    await act(async () => { await new Promise((resolve) => window.requestAnimationFrame(resolve)); });
    expect(header.classList.contains(styles.siteHeaderHidden)).toBe(false);
    screen.getByRole("heading", { level: 1 }).focus();
    await waitFor(() => expect(header.classList.contains(styles.siteHeaderHidden)).toBe(true));
  });
});
