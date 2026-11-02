import { act, fireEvent, render, screen, within } from "@testing-library/react";
import type { ComponentProps } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { PublicProperty } from "@/lib/public-properties";

const mocks = vi.hoisted(() => ({ fetchProperty: vi.fn(), slug: "garden-house", pathname: "/book/garden-house", panel: vi.fn() }));
vi.mock("next/navigation", () => ({ useParams: () => ({ slug: mocks.slug }), usePathname: () => mocks.pathname }));
vi.mock("@/components/Header", () => ({ Header: () => <header>Marketplace header Kooch</header> }));
vi.mock("@/components/Footer", () => ({ Footer: () => <footer>Marketplace footer Kooch</footer> }));
vi.mock("@/lib/public-properties", async (original) => ({ ...await original<typeof import("@/lib/public-properties")>(), fetchPublicApi: mocks.fetchProperty }));
vi.mock("@/components/booking/PropertyBookingPanel", () => ({
  PropertyBookingPanel: (props: ComponentProps<typeof import("@/components/booking/PropertyBookingPanel").PropertyBookingPanel>) => {
    mocks.panel(props);
    return props.children({ searchBar: <div>جستجوی واقعی</div>, roomSelection: <div>انتخاب تعداد اتاق</div> });
  },
}));

import { PropertyBookingLanding } from "@/components/booking/PropertyBookingLanding";
import { PropertyPhoto } from "@/components/booking/PropertyPhoto";
import { PublicSiteShell } from "@/components/PublicSiteShell";
import { PublicApiError } from "@/lib/public-properties";

function property(): PublicProperty {
  const room = {
    id: 1, name: "اتاق باغ", roomKind: "Double" as const, roomKindCode: "Double", englishName: null,
    description: "اتاق رو به باغ", basePrice: null, availabilityPrice: null, displayPrice: null,
    availabilityStatus: null, inventoryMode: "TypeBasedInventory" as const, totalInventory: 2,
    maxAdults: 2, maxChildren: 1, allowExtraGuest: false, maxExtraGuests: 0, notes: null,
    floorNumber: null, stairCount: null, hasWindow: true, hasPrivateBathroom: true,
    bedInformation: [], images: [{ id: 1, url: "/room.jpg", altText: "نمای اتاق باغ", caption: null, tag: null, isCover: true }],
    amenities: [{ id: 1, name: "حمام", category: "اتاق" }],
  };
  return {
    id: 10, slug: "garden-house", name: "خانه باغ", englishName: null, seoTitle: null, seoDescription: null,
    city: "کاشان", country: "IR", address: "خیابان باغ", description: "خانه‌ای در میان باغ", shortDescription: "اقامت در باغ",
    coverImageUrl: "/house.jpg", status: "Approved", propertyType: "House", inventoryMode: "TypeBasedInventory",
    checkInTime: "14:00:00", checkOutTime: "12:00:00", regularReceptionFrom: null, regularReceptionUntil: null,
    latitude: null, longitude: null, hasElevator: false, isWheelchairAccessible: null, hasGroundFloorRoom: null,
    hasAccessibleBathroom: null, isInstantBooking: false, startingPrice: null, matchingRoomTypesCount: 0,
    matchingRoomTypes: [], guestFitStatus: "Unknown", availabilitySummary: "Unknown", availabilityStatusSummary: "Unknown",
    freeChildAgeLimit: null, maxFreeChildren: null, images: [], descriptionSections: [], commonAreas: [], settings: [],
    amenities: [], nearbyPlaces: [], views: [], roomTypes: [room, { ...room, id: 2, name: "اتاق حیاط", description: "نمای حیاط", images: [] }],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.slug = "garden-house";
  mocks.pathname = "/book/garden-house";
  mocks.fetchProperty.mockResolvedValue(property());
});

describe("Property booking landing", () => {
  it("resolves the slug, renders actual identity, image and shared booking slots without marketplace chrome", async () => {
    const { container } = render(<PublicSiteShell><PropertyBookingLanding /></PublicSiteShell>);
    expect(screen.getByRole("status").textContent).toContain("در حال دریافت");
    expect(await screen.findByRole("heading", { level: 1, name: "خانه باغ" })).toBeTruthy();
    expect(mocks.fetchProperty).toHaveBeenCalledWith("/properties/garden-house");
    expect(container.querySelector('img[src*="house.jpg"]')).toBeTruthy();
    expect(screen.getByText("جستجوی واقعی")).toBeTruthy();
    expect(container.textContent).not.toMatch(/Kooch|کوچ|Marketplace|Powered by/i);
    expect(container.querySelector('[dir="rtl"]')).toBeTruthy();
    const props = mocks.panel.mock.calls.at(-1)![0];
    expect(props.propertyId).toBe(10);
    expect(props.roomTypes).toHaveLength(2);
    expect(props.guests).toEqual({ rooms: 1, adults: 2, children: 0, childAges: [] });
    expect(Object.keys(props).join()).not.toMatch(/commission|channel/i);
  });

  it("switches preview only and falls back to the actual Property image without touching the cart", async () => {
    sessionStorage.setItem("cart-sentinel", "unchanged");
    render(<PropertyBookingLanding />);
    const nav = await screen.findByRole("navigation", { name: "پیش‌نمایش اتاق‌ها" });
    const second = within(nav).getByRole("button", { name: /اتاق حیاط/ });
    fireEvent.click(second);
    expect(second.getAttribute("aria-pressed")).toBe("true");
    const preview = screen.getByRole("region", { name: "اتاق حیاط" });
    expect(within(preview).getByText("نمای حیاط")).toBeTruthy();
    expect(within(preview).getByRole("img").getAttribute("src")).toContain("house.jpg");
    expect(sessionStorage.getItem("cart-sentinel")).toBe("unchanged");
    expect(sessionStorage.length).toBe(1);
    expect(mocks.panel.mock.calls.at(-1)![0].guests.rooms).toBe(1);
    expect(screen.getByRole("link", { name: /انتخاب تاریخ و رزرو/ }).getAttribute("href")).toBe("#booking");
  });

  it("renders stable two-digit room indices with real capacity and independently selected preview state", async () => {
    const data = property();
    data.roomTypes = [data.roomTypes[1], data.roomTypes[0]];
    mocks.fetchProperty.mockResolvedValueOnce(data);
    render(<PropertyBookingLanding />);
    const nav = await screen.findByRole("navigation", { name: "پیش‌نمایش اتاق‌ها" });
    const choices = within(nav).getAllByRole("button");
    expect(choices.map((choice) => choice.getAttribute("aria-labelledby"))).toEqual(["room-nav-name-2", "room-nav-name-1"]);
    expect(within(choices[0]).getByText("01").getAttribute("aria-hidden")).toBe("true");
    expect(within(choices[1]).getByText("02").getAttribute("dir")).toBe("ltr");
    expect(within(choices[0]).getByText("ظرفیت: ۲ بزرگسال، ۱ کودک")).toBeTruthy();
    expect(within(choices[0]).queryByText("نمای حیاط")).toBeNull();
    expect(choices[0].querySelector('[aria-hidden="true"]:not([dir])')).toBeTruthy();
    expect(choices[0].getAttribute("aria-pressed")).toBe("true");
    choices[1].focus();
    expect(document.activeElement).toBe(choices[1]);
    // Merely focusing a preview must not change its selection or the booking cart.
    expect(choices[0].getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(choices[1]);
    expect(choices[0].getAttribute("aria-pressed")).toBe("false");
    expect(choices[1].getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("region", { name: "اتاق باغ" })).toBeTruthy();
    expect(sessionStorage.length).toBe(0);
  });

  it("preserves long Persian room names and uses actual adult/child capacity instead of description excerpts", async () => {
    const data = property();
    const longName = "اتاق شاه‌نشین رو به حیاط مرکزی با نام بسیار طولانی برای اقامت خانوادگی";
    data.roomTypes[0] = { ...data.roomTypes[0], name: longName, description: "  اتاقی رو به باغ\n  با پنجره‌های چوبی  " };
    data.roomTypes[1] = { ...data.roomTypes[1], description: " \n ", maxAdults: 4, maxChildren: 0 };
    mocks.fetchProperty.mockResolvedValueOnce(data);
    render(<PropertyBookingLanding />);
    const nav = await screen.findByRole("navigation", { name: "پیش‌نمایش اتاق‌ها" });
    const first = within(nav).getByRole("button", { name: longName });
    expect(within(first).getByText(longName).textContent).toBe(longName);
    expect(within(first).getByText("ظرفیت: ۲ بزرگسال، ۱ کودک")).toBeTruthy();
    expect(first.textContent).not.toContain("پنجره‌های چوبی");
    const second = within(nav).getByRole("button", { name: "اتاق حیاط" });
    expect(within(second).getByText("ظرفیت: ۴ بزرگسال، ۰ کودک")).toBeTruthy();
    expect(second.getAttribute("aria-describedby")).toBe("room-nav-summary-2");
    expect(within(nav).queryByText(/تومان|قیمت|موجودی|رزرو آنی/)).toBeNull();
  });

  it("fails closed for an unapproved response and for 404", async () => {
    mocks.fetchProperty.mockResolvedValueOnce({ ...property(), status: "Draft" });
    const first = render(<PropertyBookingLanding />);
    expect(await screen.findByText("اقامتگاه در دسترس نیست")).toBeTruthy();
    expect(mocks.panel).not.toHaveBeenCalled();
    first.unmount();
    mocks.fetchProperty.mockRejectedValueOnce(new PublicApiError(404, "missing"));
    render(<PropertyBookingLanding />);
    expect(await screen.findByText("اقامتگاه در دسترس نیست")).toBeTruthy();
    expect(screen.queryByRole("heading", { level: 1 })).toBeNull();
  });

  it("shows an API error and retries without fabricated Property data", async () => {
    mocks.fetchProperty.mockRejectedValueOnce(new Error("offline"));
    render(<PropertyBookingLanding />);
    expect(await screen.findByText("دریافت اطلاعات انجام نشد")).toBeTruthy();
    expect(screen.queryByText("خانه باغ")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "تلاش دوباره" }));
    expect(await screen.findByRole("heading", { level: 1, name: "خانه باغ" })).toBeTruthy();
    expect(mocks.fetchProperty).toHaveBeenCalledTimes(2);
  });

  it("ignores out-of-order Property responses and hides previous Property content on slug change", async () => {
    let resolveFirst!: (value: PublicProperty) => void;
    mocks.fetchProperty.mockReturnValueOnce(new Promise<PublicProperty>((resolve) => { resolveFirst = resolve; }));
    const view = render(<PropertyBookingLanding />);
    mocks.slug = "new-house";
    mocks.fetchProperty.mockResolvedValueOnce({ ...property(), slug: "new-house", name: "خانه جدید" });
    view.rerender(<PropertyBookingLanding />);
    expect(await screen.findByRole("heading", { level: 1, name: "خانه جدید" })).toBeTruthy();
    await act(async () => { resolveFirst(property()); });
    expect(screen.queryByRole("heading", { level: 1, name: "خانه باغ" })).toBeNull();
    mocks.slug = "third-house";
    mocks.fetchProperty.mockReturnValueOnce(new Promise(() => {}));
    view.rerender(<PropertyBookingLanding />);
    expect(screen.queryByRole("heading", { level: 1 })).toBeNull();
    expect(screen.getByRole("status")).toBeTruthy();
  });

  it("handles a real empty room list and missing imagery without an empty image src", async () => {
    mocks.fetchProperty.mockResolvedValueOnce({ ...property(), coverImageUrl: null, roomTypes: [], description: "", shortDescription: "", checkInTime: null, checkOutTime: null, address: "" });
    const { container } = render(<PropertyBookingLanding />);
    expect(await screen.findByText("هنوز اتاقی برای نمایش ثبت نشده است.")).toBeTruthy();
    expect(container.querySelector("img")).toBeNull();
    expect(mocks.panel).not.toHaveBeenCalled();
    expect(screen.queryByText("زمان اقامت")).toBeNull();
  });

  it("provides horizontal mobile room navigation, desktop RTL columns and local zero header offset", () => {
    const css = readFileSync(resolve(process.cwd(), "components/booking/PropertyBookingLanding.module.css"), "utf8");
    expect(css).toContain("--header-height: 0px");
    expect(css).toContain("overflow-x: auto");
    expect(css).toContain("@media (min-width: 1024px)");
    expect(css).toContain("grid-template-columns: var(--room-panel-width) minmax(0, 1fr)");
    expect(css).toContain("overflow-y: auto");
    expect(css).toContain("prefers-reduced-motion");
    const route = readFileSync(resolve(process.cwd(), "app/book/[slug]/page.tsx"), "utf8");
    expect(route).toContain('absolute: "رزرو اقامتگاه"');
  });

  it("uses one full-height edge panel, without a central scrim, navbar fill or bottom strip", async () => {
    const css = readFileSync(resolve(process.cwd(), "components/booking/PropertyBookingLanding.module.css"), "utf8");
    const source = readFileSync(resolve(process.cwd(), "components/booking/PropertyBookingLanding.tsx"), "utf8");
    expect(source).not.toContain("styles.shade");
    expect(css).not.toMatch(/\.shade\s*\{/);
    expect(css).toMatch(/\.hero::before\s*\{[^}]*inset-block: 0;[^}]*inset-inline-start: 0;[^}]*width: var\(--room-panel-width\);[^}]*background: color-mix/);
    expect(css).toContain("--room-panel-width: clamp(300px, 25vw, 390px)");
    expect(css).toContain("--room-panel-width: clamp(260px, 28vw, 300px)");
    expect(css).toMatch(/\.roomNav\s*\{[^}]*background: transparent;[^}]*contain: size;/);
    expect(css).not.toMatch(/\.(header|scene)[^{]*\{[^}]*max-width/);
    expect(css).toMatch(/\.header\s*\{[^}]*background: transparent;/);
    expect(css).not.toContain("--text-scrim-opacity");
    expect(css).not.toContain(".identityLead::before");
    expect(css).not.toContain(".previewCopy::before");
    expect(css).not.toContain("mask-image");
    expect(css).not.toContain("linear-gradient");
    render(<PropertyBookingLanding />);
    const hero = await screen.findByRole("region", { name: "معرفی خانه باغ" });
    const note = screen.getByText("پیش‌نمایش اتاق، آن را به رزرو اضافه نمی‌کند. ظرفیت و قیمت پس از انتخاب تاریخ بررسی می‌شود.");
    expect(hero.contains(note)).toBe(false);
    expect(screen.getByRole("region", { name: "اقامت خود را انتخاب کنید" }).contains(note)).toBe(true);
  });

  it("animates only room names and header underlines, without moving separators or ignoring reduced motion", () => {
    const css = readFileSync(resolve(process.cwd(), "components/booking/PropertyBookingLanding.module.css"), "utf8");
    expect(css).toMatch(/\.hero \.roomChoice\s*\{[^}]*background: transparent;[^}]*box-shadow: none;/);
    expect(css).toContain("text-decoration: none");
    expect(css).toContain("overflow-wrap: anywhere");
    expect(css).toMatch(/\.roomSeparator\s*\{[^}]*height: 1px;/);
    expect(css).toContain("(hover: hover) and (pointer: fine)");
    expect(css).toMatch(/\.roomChoice:focus-visible \.roomName\s*\{ transform: scale\(1\.04\);/);
    expect(css).not.toMatch(/\.roomChoiceContent\s*\{[^}]*transform/);
    expect(css).toMatch(/\.links a::after\s*\{[^}]*transform: scaleX\(0\);[^}]*transform-origin: right center;/);
    expect(css).toContain(".links a:hover::after, .links a:focus-visible::after { transform: scaleX(1); }");
    expect(css).toMatch(/prefers-reduced-motion: reduce[\s\S]*transition: none;[\s\S]*\.roomChoice:hover \.roomName, \.roomChoice:focus-visible \.roomName \{ transform: none; \}/);
    expect(css).not.toContain(":global");
  });

  it("preserves hero link destinations and uses a local charcoal booking control", async () => {
    render(<PropertyBookingLanding />);
    const links = await screen.findByRole("navigation", { name: "راهنمای اقامتگاه" });
    expect(within(links).getAllByRole("link").map((link) => link.getAttribute("href"))).toEqual(["#booking", "#property-introduction", "#property-location"]);
    expect(screen.getByRole("link", { name: "انتخاب تاریخ و رزرو" }).getAttribute("href")).toBe("#booking");
    const css = readFileSync(resolve(process.cwd(), "components/booking/PropertyBookingLanding.module.css"), "utf8");
    expect(css).toMatch(/\.bookingLink\s*\{[^}]*background: var\(--card\);[^}]*color: var\(--card-foreground\);/);
    expect(css).toContain(".bookingLink:hover, .bookingLink:active");
    expect(css).toContain(".landing a:focus-visible");
  });

  it("retains a long room list inside the pane without creating booking selections", async () => {
    const data = property();
    data.roomTypes = Array.from({ length: 60 }, (_, index) => ({ ...data.roomTypes[0], id: index + 1, name: `اتاق ${index + 1}` }));
    mocks.fetchProperty.mockResolvedValueOnce(data);
    render(<PropertyBookingLanding />);
    const nav = await screen.findByRole("navigation", { name: "پیش‌نمایش اتاق‌ها" });
    expect(within(nav).getAllByRole("button")).toHaveLength(60);
    expect(within(nav).getByText("60")).toBeTruthy();
    expect(sessionStorage.length).toBe(0);
    expect(mocks.panel.mock.calls.at(-1)![0].roomTypes).toHaveLength(60);
  });
});

describe("actual image fallback", () => {
  it("tries a real Property photo after a failed room photo, then renders a neutral fallback", () => {
    render(<PropertyPhoto alt="اتاق" height={300} width={400} sources={["/room.jpg", "/house.jpg"]} />);
    fireEvent.error(screen.getByRole("img"));
    expect(screen.getByRole("img").getAttribute("src")).toContain("house.jpg");
    fireEvent.error(screen.getByRole("img"));
    expect(screen.getByText("تصویر در دسترس نیست")).toBeTruthy();
    expect(screen.getByRole("img").getAttribute("aria-label")).toBe("اتاق");
  });

  it("resets failed-image state for a different room", () => {
    const view = render(<PropertyPhoto alt="اتاق" height={300} width={400} sources={["/old.jpg"]} />);
    fireEvent.error(screen.getByRole("img"));
    view.rerender(<PropertyPhoto alt="اتاق جدید" height={300} width={400} sources={["/new.jpg"]} />);
    expect(screen.getByRole("img").getAttribute("src")).toContain("new.jpg");
  });
});

describe("public chrome boundary", () => {
  it.each(["/properties/garden-house", "/login", "/booking/checkout", "/book", "/book/garden-house/other", "/admin"])("preserves incumbent chrome on %s", (path) => {
    mocks.pathname = path;
    render(<PublicSiteShell><p>محتوا</p></PublicSiteShell>);
    expect(screen.getByText("Marketplace header Kooch")).toBeTruthy();
    expect(screen.getByText("Marketplace footer Kooch")).toBeTruthy();
  });

  it("restores public chrome after leaving the landing", () => {
    const view = render(<PublicSiteShell><p>محتوا</p></PublicSiteShell>);
    expect(screen.queryByRole("banner")).toBeNull();
    mocks.pathname = "/properties/garden-house";
    view.rerender(<PublicSiteShell><p>محتوا</p></PublicSiteShell>);
    expect(screen.getByRole("banner")).toBeTruthy();
  });
});
