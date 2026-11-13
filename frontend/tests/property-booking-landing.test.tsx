import { act, fireEvent, render, screen, within } from "@testing-library/react";
import type { ComponentProps, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderToString } from "react-dom/server";
import type { PublicProperty } from "@/lib/public-properties";

const mocks = vi.hoisted(() => ({ fetchProperty: vi.fn(), slug: "garden-house", pathname: "/book/garden-house", query: "", panel: vi.fn() }));
vi.mock("next/navigation", () => ({ useParams: () => ({ slug: mocks.slug }), usePathname: () => mocks.pathname, useSearchParams: () => new URLSearchParams(mocks.query) }));
vi.mock("@/components/Header", () => ({ Header: () => <header>Marketplace header Kooch</header> }));
vi.mock("@/components/Footer", () => ({ Footer: () => <footer>Marketplace footer Kooch</footer> }));
vi.mock("@/components/reviews/GuestReviewInvitation", () => ({ GuestReviewInvitation: () => null }));
vi.mock("@/components/auth/UserProfileAvatarProvider", () => ({ UserProfileAvatarProvider: ({ children }: { children: ReactNode }) => children }));
vi.mock("@/lib/public-properties", async (original) => ({ ...await original<typeof import("@/lib/public-properties")>(), fetchPublicApi: mocks.fetchProperty }));
vi.mock("@/components/booking/PropertyBookingPanel", () => ({
  propertyRoomsAnchorId: "property-rooms",
  PropertyBookingPanel: (props: ComponentProps<typeof import("@/components/booking/PropertyBookingPanel").PropertyBookingPanel>) => {
    mocks.panel(props);
    return props.children({ searchBar: <div>جستجوی واقعی</div>, roomSelection: <div>انتخاب تعداد اتاق{props.roomTypes.map((room) => <button key={room.id} onClick={() => props.onShowRoomDetails(room)}>مشاهده {room.name}</button>)}</div> });
  },
}));

import { PropertyBookingLanding } from "@/components/booking/PropertyBookingLanding";
import { PropertyPhoto } from "@/components/booking/PropertyPhoto";
import { PublicSiteShell } from "@/components/PublicSiteShell";
import { PublicApiError } from "@/lib/public-properties";
vi.mock("@/components/booking/PropertyGuestAccount", () => ({ PropertyGuestAccount: ({ navigation = [] }: { navigation?: Array<{ href: string; label: string }> }) => <nav aria-label="راهنمای اقامتگاه">{navigation.map((link) => <a href={link.href} key={link.href}>{link.label}</a>)}</nav> }));

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
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: vi.fn() });
  mocks.slug = "garden-house";
  mocks.pathname = "/book/garden-house";
  mocks.query = "";
  window.history.replaceState(null, "", "/book/garden-house");
  mocks.fetchProperty.mockResolvedValue(property());
});

describe("Property booking landing", () => {
  it.each([[1, "single"], [2, "pair"], [3, "grid"]] as const)("selects a count-aware composition for %i actual RoomTypes", async (count, layout) => {
    const data = property();
    data.roomTypes = Array.from({ length: count }, (_, index) => ({ ...data.roomTypes[0], id: index + 1, name: `اتاق ${index + 1}` }));
    mocks.fetchProperty.mockResolvedValueOnce(data);
    render(<PropertyBookingLanding />);
    await screen.findByRole("heading", { level: 1 });
    expect(document.getElementById("property-rooms")?.getAttribute("data-room-layout")).toBe(layout);
    expect(mocks.panel.mock.calls.at(-1)![0].roomTypes).toHaveLength(count);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.querySelectorAll('img[src*="room.jpg"]')).toHaveLength(0);
  });

  it("renders real initial Property content on the server without a second client fetch", () => {
    const data = property();
    const html = renderToString(<PropertyBookingLanding initialProperty={data} initialSlug={data.slug} />);
    expect(html).toContain("خانه باغ");
    expect(html).toContain("خانه‌ای در میان باغ");
    expect(html).toContain("خیابان باغ");
    expect(html).not.toContain("در حال دریافت اقامتگاه");
    render(<PropertyBookingLanding initialProperty={data} initialSlug={data.slug} />);
    expect(screen.getByRole("heading", { level: 1, name: data.name })).toBeTruthy();
    expect(mocks.fetchProperty).not.toHaveBeenCalled();
  });
  it("initializes the shared booking engine from canonical URL context with ordered child ages", async () => {
    mocks.query = "checkIn=2030-08-10&checkOut=2030-08-12&rooms=2&adults=4&children=2&childAges=4,9";
    render(<PropertyBookingLanding />);
    await screen.findByRole("heading", { level: 1 });
    const props = mocks.panel.mock.calls.at(-1)![0];
    expect(props.dates).toEqual({ startDate: "2030-08-10", endDate: "2030-08-12" });
    expect(props.guests).toEqual({ rooms: 2, adults: 4, children: 2, childAges: [4, 9] });
    expect(props.autoCheckInitialContextKey).toContain("[4,9]");
    expect(props.entryKind).toBe("book");
    expect(screen.getByText("انتخاب تعداد اتاق").parentElement?.id).toBe("property-rooms");
    expect(document.querySelectorAll("#property-rooms")).toHaveLength(1);
  });

  it("keeps edits across stale query wrappers, refresh, and external navigation without coupling preview selection", async () => {
    mocks.query = "checkIn=2030-08-10&checkOut=2030-08-12&rooms=1&adults=2&children=0&utm_source=test";
    const view = render(<PropertyBookingLanding />);
    await screen.findByRole("heading", { level: 1 });
    const initialKey = mocks.panel.mock.calls.at(-1)![0].autoCheckInitialContextKey;
    act(() => {
      mocks.panel.mock.calls.at(-1)![0].onGuestsChange({ rooms: 2, adults: 4, children: 2, childAges: [4, 9] });
      mocks.panel.mock.calls.at(-1)![0].onDatesChange({ startDate: "2030-09-10", endDate: "2030-09-12" });
    });
    view.rerender(<PropertyBookingLanding />);
    let props = mocks.panel.mock.calls.at(-1)![0];
    expect(props.guests.childAges).toEqual([4, 9]);
    expect(props.dates.startDate).toBe("2030-09-10");
    expect(props.autoCheckInitialContextKey).toBe(initialKey);
    expect(window.location.search).toContain("childAges=4%2C9");
    expect(window.location.search).toContain("utm_source=test");
    fireEvent.click(screen.getByRole("button", { name: "مشاهده اتاق حیاط" }));
    expect(mocks.panel.mock.calls.at(-1)![0].guests.rooms).toBe(2);
    // Next's native-history echo must not start a search or reset newer edits.
    mocks.query = window.location.search.slice(1);
    view.rerender(<PropertyBookingLanding />);
    expect(mocks.panel.mock.calls.at(-1)![0].autoCheckInitialContextKey).toBe(initialKey);
    view.unmount();
    const refreshed = render(<PropertyBookingLanding />);
    await screen.findByRole("heading", { level: 1 });
    props = mocks.panel.mock.calls.at(-1)![0];
    expect(props.guests).toEqual({ rooms: 2, adults: 4, children: 2, childAges: [4, 9] });
    expect(props.dates.startDate).toBe("2030-09-10");
    mocks.query = "checkIn=2030-10-10&checkOut=2030-10-12&rooms=1&adults=3&children=0";
    refreshed.rerender(<PropertyBookingLanding />);
    props = mocks.panel.mock.calls.at(-1)![0];
    expect(props.guests.adults).toBe(3);
    expect(props.dates.startDate).toBe("2030-10-10");
  });

  it("falls back safely for malformed query context and exposes a scroll margin on actual results", async () => {
    mocks.query = "checkIn=wrong&rooms=-1&adults=Infinity&children=99999999999999999";
    render(<PropertyBookingLanding />);
    await screen.findByRole("heading", { level: 1 });
    const props = mocks.panel.mock.calls.at(-1)![0];
    expect(props.dates).toEqual({ startDate: null, endDate: null });
    expect(props.guests).toEqual({ rooms: 1, adults: 2, children: 0, childAges: [] });
    expect(props.autoCheckInitialContextKey).toBeNull();
    const css = readFileSync(resolve(process.cwd(), "components/booking/PropertyBookingLanding.module.css"), "utf8");
    expect(css).toMatch(/\.bookingRooms\s*\{[^}]*scroll-margin-top:[^}]*--property-booking-search-height/);
  });

  it("uses Next-compatible native replacement once per changed context and preserves the current hash", async () => {
    window.history.replaceState({ __NA: true }, "", "/book/garden-house#booking");
    render(<PropertyBookingLanding />);
    await screen.findByRole("heading", { level: 1 });
    const replace = vi.spyOn(window.history, "replaceState");
    const guests = { rooms: 2, adults: 3, children: 2, childAges: [4, 9] };
    act(() => mocks.panel.mock.calls.at(-1)![0].onGuestsChange(guests));
    act(() => mocks.panel.mock.calls.at(-1)![0].onGuestsChange(guests));
    expect(replace).toHaveBeenCalledTimes(1);
    expect(replace).toHaveBeenCalledWith(null, "", expect.stringMatching(/^\/book\/garden-house\?.*#booking$/));
    replace.mockRestore();
  });

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

  it("shows only real facilities after the functional rooms, without reference-image claims", async () => {
    const data = property();
    data.amenities = [{ id: 9, name: "حیاط مرکزی", category: "عمومی" }, { id: 10, name: "اینترنت", category: "عمومی" }];
    mocks.fetchProperty.mockResolvedValueOnce(data);
    render(<PropertyBookingLanding />);
    const facilities = await screen.findByRole("region", { name: "امکانات و خدمات اقامتگاه" });
    expect(within(facilities).getAllByRole("listitem").map((item) => item.textContent)).toEqual(["حیاط مرکزی", "اینترنت"]);
    expect(document.getElementById("property-rooms")!.compareDocumentPosition(facilities) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByRole("link", { name: "امکانات" }).getAttribute("href")).toBe("#property-facilities");
    expect(document.body.textContent).not.toMatch(/Royal Crest|اسپا|انتقال فرودگاهی|استخر|تخفیف/);
  });

  it("hides absent facilities and falls back to an actual Property image for the hero", async () => {
    const data = property();
    data.coverImageUrl = null;
    data.images = [{ ...data.roomTypes[0].images[0], url: "/actual-property.jpg" }];
    mocks.fetchProperty.mockResolvedValueOnce(data);
    render(<PropertyBookingLanding />);
    const hero = await screen.findByRole("region", { name: "معرفی خانه باغ" });
    expect(hero.parentElement!.querySelector('img[src*="actual-property.jpg"]')).toBeTruthy();
    expect(screen.queryByRole("region", { name: "امکانات و خدمات اقامتگاه" })).toBeNull();
    expect(screen.queryByRole("link", { name: "امکانات" })).toBeNull();
  });

  it("switches preview only and falls back to the actual Property image without touching the cart", async () => {
    sessionStorage.setItem("cart-sentinel", "unchanged");
    render(<PropertyBookingLanding />);
    const second = await screen.findByRole("button", { name: "مشاهده اتاق حیاط" });
    fireEvent.click(second);
    const preview = await screen.findByRole("dialog", { name: "اتاق حیاط" });
    expect(within(preview).getByText("نمای حیاط")).toBeTruthy();
    expect(within(preview).getByRole("img").getAttribute("src")).toContain("house.jpg");
    expect(sessionStorage.getItem("cart-sentinel")).toBe("unchanged");
    expect(sessionStorage.length).toBe(1);
    expect(mocks.panel.mock.calls.at(-1)![0].guests.rooms).toBe(1);
    expect(screen.getByRole("link", { name: /انتخاب تاریخ و رزرو/ }).getAttribute("href")).toBe("#booking");
  });

  it("preserves API room ordering and independently selected details without cart changes", async () => {
    const data = property();
    data.roomTypes = [data.roomTypes[1], data.roomTypes[0]];
    mocks.fetchProperty.mockResolvedValueOnce(data);
    render(<PropertyBookingLanding />);
    await screen.findByRole("heading", { level: 1 });
    const choices = screen.getAllByRole("button", { name: /^مشاهده اتاق/ });
    expect(choices.map((choice) => choice.textContent)).toEqual(["مشاهده اتاق حیاط", "مشاهده اتاق باغ"]);
    choices[1].focus();
    expect(document.activeElement).toBe(choices[1]);
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(choices[1]);
    const dialog = await screen.findByRole("dialog", { name: "اتاق باغ" });
    fireEvent.click(within(dialog).getByRole("button", { name: "بازگشت به انتخاب اتاق" }));
    await vi.waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await vi.waitFor(() => expect(document.activeElement).toBe(choices[1]));
    expect(sessionStorage.length).toBe(0);
  });

  it("preserves long Persian room names and actual capacity in connected room details", async () => {
    const data = property();
    const longName = "اتاق شاه‌نشین رو به حیاط مرکزی با نام بسیار طولانی برای اقامت خانوادگی";
    data.roomTypes[0] = { ...data.roomTypes[0], name: longName, description: "  اتاقی رو به باغ\n  با پنجره‌های چوبی  " };
    data.roomTypes[1] = { ...data.roomTypes[1], description: " \n ", maxAdults: 4, maxChildren: 0 };
    mocks.fetchProperty.mockResolvedValueOnce(data);
    render(<PropertyBookingLanding />);
    fireEvent.click(await screen.findByRole("button", { name: `مشاهده ${longName}` }));
    const first = await screen.findByRole("dialog", { name: longName });
    expect(within(first).getByText("ظرفیت بزرگسال: ۲ · ظرفیت کودک: ۱")).toBeTruthy();
    fireEvent.click(within(first).getByRole("button", { name: "بازگشت به انتخاب اتاق" }));
    await vi.waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "مشاهده اتاق حیاط" }));
    const second = await screen.findByRole("dialog", { name: "اتاق حیاط" });
    expect(within(second).getByText("ظرفیت بزرگسال: ۴ · ظرفیت کودک: ۰")).toBeTruthy();
    expect(within(second).queryByText(/تومان|رزرو آنی/)).toBeNull();
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
    expect(await screen.findByText("در حال حاضر اتاقی برای بررسی رزرو وجود ندارد.")).toBeTruthy();
    expect(container.querySelector("img")).toBeNull();
    expect(mocks.panel).not.toHaveBeenCalled();
    expect(screen.queryByText("زمان اقامت")).toBeNull();
  });

  it("provides responsive real room cards and a local zero header offset", () => {
    const css = readFileSync(resolve(process.cwd(), "components/booking/PropertyBookingLanding.module.css"), "utf8");
    expect(css).toContain("--header-height: 0px");
    expect(css).toContain("@media (min-width: 1024px)");
    expect(css).toContain('[data-room-layout="single"]');
    expect(css).toContain('[data-room-layout="grid"]');
    expect(css).toContain('repeat(3, minmax(0, 1fr))');
    expect(css).toContain('.bookingRooms [role="listitem"]');
    expect(css).toContain("prefers-reduced-motion");
    const route = readFileSync(resolve(process.cwd(), "app/book/[slug]/page.tsx"), "utf8");
    expect(route).toContain("export async function generateMetadata");
    expect(route).toContain("propertyBookingMetadata");
  });

  it("uses a cinematic hero before the real search and room selection", async () => {
    const css = readFileSync(resolve(process.cwd(), "components/booking/PropertyBookingLanding.module.css"), "utf8");
    const source = readFileSync(resolve(process.cwd(), "components/booking/PropertyBookingLanding.tsx"), "utf8");
    expect(css).toContain(".heroPhoto::after");
    expect(css).toContain("linear-gradient(270deg");
    expect(css).not.toContain("--room-panel-width");
    expect(source).toContain("guestStyles.scope");
    render(<PropertyBookingLanding />);
    const hero = await screen.findByRole("region", { name: "معرفی خانه باغ" });
    expect(hero.contains(screen.getByText("جستجوی واقعی"))).toBe(false);
    expect(screen.getByText("جستجوی واقعی").compareDocumentPosition(screen.getByText("انتخاب تعداد اتاق")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(hero.querySelector("#room-preview")).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(hero.parentElement!.querySelector('[class*="heroPhoto"]')).toBeTruthy();
  });

  it("keeps scoped focus and reduced-motion rules without expensive animated effects", () => {
    const css = readFileSync(resolve(process.cwd(), "components/booking/PropertyBookingLanding.module.css"), "utf8");
    expect(css).toContain("overflow-wrap: anywhere");
    expect(css).toContain(":focus-visible");
    expect(css).toMatch(/prefers-reduced-motion: reduce[\s\S]*transition: none/);
    expect(css).toContain(".header, .search > div:first-child");
    expect(css).not.toMatch(/\.hero\s*\{[^}]*backdrop-filter/);
    expect(css).not.toMatch(/\.heroPhoto\s*\{[^}]*backdrop-filter/);
    expect(css).not.toContain(":global");
  });

  it("separates edge-to-edge glass surfaces from centered responsive content", async () => {
    render(<PropertyBookingLanding />);
    const hero = await screen.findByRole("region", { name: "معرفی خانه باغ" });
    const header = hero.querySelector("header")!;
    const inner = header.firstElementChild!;
    expect(inner.className).toContain("headerInner");
    expect(inner.contains(screen.getByRole("navigation", { name: "راهنمای اقامتگاه" }))).toBe(true);
    expect(inner.contains(screen.getByRole("link", { name: "بررسی موجودی" }))).toBe(true);
    expect(hero.nextElementSibling).toBe(document.getElementById("booking"));
    expect(document.getElementById("booking")!.children[1].contains(screen.getByText("جستجوی واقعی"))).toBe(true);

    const css = readFileSync(resolve(process.cwd(), "components/booking/PropertyBookingLanding.module.css"), "utf8");
    const rule = (selector: string) => css.slice(css.indexOf(`${selector} {`)).split("}")[0];
    for (const selector of [".header", ".search", ".search > div:first-child"]) {
      const surface = rule(selector);
      expect(surface).toContain("width: 100%");
      expect(surface).toContain("margin: 0");
      expect(surface).not.toMatch(/max-width: var|100vw|box-shadow: 0|border-radius: \.|margin-top: -/);
    }
    for (const selector of [".headerInner", ".search > div:first-child > div"]) {
      const innerRule = rule(selector);
      expect(innerRule).toContain("max-width: var(--direct-width)");
      expect(innerRule).toContain("margin-inline: auto");
      expect(innerRule).toContain("var(--direct-gutter)");
      expect(innerRule).toContain("min-width: 0");
    }
    expect(css).toMatch(/@media \(min-width: 900px\)\s*\{\s*\.headerInner \{ display: grid/);
    expect(css).toContain(".headerInner > nav");
    expect(css).not.toMatch(/margin-top: -|:global/);
  });

  it("shares one photographic grid backdrop across the hero and sticky search without clipping popovers", async () => {
    render(<PropertyBookingLanding />);
    const hero = await screen.findByRole("region", { name: "معرفی خانه باغ" });
    const booking = document.getElementById("booking")!;
    const layout = hero.parentElement!;
    expect(layout.className).toContain("bookingLayout");
    expect(booking.parentElement).toBe(layout);
    expect(document.getElementById("property-rooms")!.parentElement).toBe(layout);
    expect(layout.querySelectorAll('[class*="heroPhoto"]')).toHaveLength(1);
    expect(hero.querySelector('[class*="heroPhoto"]')).toBeNull();
    expect(hero.querySelector('img')).toBeNull();
    const css = readFileSync(resolve(process.cwd(), "components/booking/PropertyBookingLanding.module.css"), "utf8");
    expect(css).toMatch(/\.heroPhoto\s*\{[^}]*grid-area: 1 \/ 1 \/ 3 \/ 2/);
    expect(css).toMatch(/\.scene::before\s*\{[^}]*pointer-events: none;[^}]*linear-gradient/);
    expect(css).toMatch(/\.booking\s*\{[^}]*position: sticky;[^}]*z-index: 40/);
    expect(css).not.toMatch(/\.(bookingLayout|hero|booking|search)\s*\{[^}]*overflow:\s*(hidden|clip)/);
    expect(css).not.toMatch(/\.(bookingLayout|hero|scene|search)\s*\{[^}]*backdrop-filter/);
    expect(css).toContain('.header .headerInner [role="menu"] { background: var(--card); -webkit-backdrop-filter: none; backdrop-filter: none; }');
  });

  it("preserves Property link destinations and uses a gold booking control", async () => {
    render(<PropertyBookingLanding />);
    const links = await screen.findByRole("navigation", { name: "راهنمای اقامتگاه" });
    expect(within(links).getAllByRole("link").map((link) => link.getAttribute("href"))).toEqual(["#booking", "#property-rooms", "#property-introduction", "#property-location"]);
    expect(screen.getByRole("link", { name: "انتخاب تاریخ و رزرو" }).getAttribute("href")).toBe("#booking");
    const css = readFileSync(resolve(process.cwd(), "components/booking/PropertyBookingLanding.module.css"), "utf8");
    expect(css).toMatch(/\.bookingLink, \.headerBooking\s*\{[^}]*background: var\(--primary\);[^}]*color: var\(--primary-foreground\);/);
    expect(css).toContain(".bookingLink:hover, .headerBooking:hover");
    expect(css).toContain(".landing :is(a, button):focus-visible");
  });

  it("passes a long actual room list to the shared engine without creating selections", async () => {
    const data = property();
    data.roomTypes = Array.from({ length: 60 }, (_, index) => ({ ...data.roomTypes[0], id: index + 1, name: `اتاق ${index + 1}` }));
    mocks.fetchProperty.mockResolvedValueOnce(data);
    render(<PropertyBookingLanding />);
    await screen.findByRole("heading", { level: 1 });
    expect(screen.getAllByRole("button", { name: /^مشاهده اتاق/ })).toHaveLength(60);
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
  it.each(["success", "payment-failure", "mock-payment"])("delegates %s chrome to the trusted payment adapter", (kind) => {
    mocks.pathname = `/book/garden-house/reservations/SESSION-1/${kind}`;
    const view = render(<PublicSiteShell><p>نتیجه رزرو</p></PublicSiteShell>);
    expect(screen.queryByText("Marketplace header Kooch")).toBeNull();
    mocks.pathname = `/booking/sessions/SESSION-1/${kind}`;
    view.rerender(<PublicSiteShell><p>نتیجه رزرو</p></PublicSiteShell>);
    expect(screen.queryByText("Marketplace header Kooch")).toBeNull();
  });
  it("omits Marketplace chrome on private Property session detail only", () => {
    mocks.pathname = "/book/garden-house/reservations/SESSION-1";
    const view = render(<PublicSiteShell><p>جزئیات رزرو</p></PublicSiteShell>);
    expect(screen.queryByText("Marketplace header Kooch")).toBeNull();
    expect(screen.queryByText("Marketplace footer Kooch")).toBeNull();
    mocks.pathname = "/account/booking-sessions/SESSION-1";
    view.rerender(<PublicSiteShell><p>جزئیات رزرو</p></PublicSiteShell>);
    expect(screen.getByText("Marketplace header Kooch")).toBeTruthy();
  });
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
