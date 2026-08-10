import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  BookingCartMobileActionBar,
  BookingCartSummary,
  groupBookingCartItems,
} from "@/components/booking/BookingCart";
import {
  bookingModePresentation,
  formatBookingCountdown,
  formatBookingDateRange,
} from "@/components/booking/booking-display";
import {
  addItemsToBookingCart,
  bookingCartStorageKey,
  BookingCartProvider,
  expandBookingCartSelection,
  restoreBookingCart,
  type BookingCartItem,
  type BookingCartSelection,
  type BookingCartState,
  useBookingCart,
} from "@/components/booking/BookingCartProvider";
import { createBookingSessionFromCart, revalidateBookingCart } from "@/components/booking/booking-checkout";
import { fetchBookingOptions } from "@/lib/booking-sessions";
import { safeInternalReturnTo } from "@/lib/safe-return-to";

function selection(overrides: Partial<BookingCartSelection> = {}): BookingCartSelection {
  return {
    propertyId: 1,
    propertyName: "خانه کاشان",
    propertySlug: "kashan-house",
    bookingMode: "Instant" as const,
    roomTypeId: 10,
    roomTypeName: "اتاق شاه‌نشین",
    checkIn: "2026-08-10",
    checkOut: "2026-08-12",
    adults: 2,
    children: 0,
    childAges: [],
    notes: null,
    displayAmount: 2_000_000,
    currency: "IRR",
    quantity: 1,
    ...overrides,
  };
}

function item(overrides: Partial<BookingCartItem> = {}): BookingCartItem {
  return { ...expandBookingCartSelection(selection())[0], ...overrides };
}

function state(items: BookingCartItem[] = []): BookingCartState {
  return {
    hydrated: true,
    propertyId: items[0]?.propertyId ?? null,
    propertyName: items[0]?.propertyName ?? "",
    propertySlug: items[0]?.propertySlug ?? "",
    bookingMode: items[0]?.bookingMode ?? null,
    idempotencyKey: items.length ? "stable-key" : null,
    checkoutRequested: false,
    items,
  };
}

describe("public booking cart", () => {
  it("expands room quantity into independent reservation items", () => {
    const items = expandBookingCartSelection(selection({ quantity: 2 }));
    expect(items).toHaveLength(2);
    expect(new Set(items.map((entry) => entry.id)).size).toBe(2);
    expect(items.every((entry) => entry.roomTypeId === 10)).toBe(true);
    expect(items.every((entry) => entry.roomId === null)).toBe(true);
    expect(items.every((entry) => entry.roomTypeName === "اتاق شاه‌نشین")).toBe(true);
  });

  it("groups multiple reservations of one RoomType into one cart line", () => {
    const items = expandBookingCartSelection(selection({ quantity: 3 }));
    const lines = groupBookingCartItems(items);

    expect(lines).toHaveLength(1);
    expect(lines[0].quantity).toBe(3);
    expect(lines[0].itemIds).toHaveLength(3);
    expect(lines[0].total).toBe(6_000_000);
  });

  it("renders Jalali dates, Persian numbers, booking mode, and the cart summary", () => {
    const items = expandBookingCartSelection(selection({ quantity: 2 }));
    render(
      <BookingCartSummary
        items={items}
        loading={false}
        onContinue={vi.fn()}
        onRemove={vi.fn()}
        total={4_000_000}
      />,
    );

    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    expect(screen.getAllByText(/۱۴۰۵/).length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText(/2026-08/)).toBeNull();
    expect(screen.getByText(/✓ رزرو آنی/)).toBeTruthy();
    expect(screen.getByText("تعداد نوع اتاق")).toBeTruthy();
    expect(screen.getByText("تعداد کل واحدها")).toBeTruthy();
    expect(screen.getByText("تعداد شب")).toBeTruthy();
    expect(screen.getByText("مبلغ کل")).toBeTruthy();
    expect(screen.getByText("اقامتگاه")).toBeTruthy();
    expect(screen.getByText("ورود و خروج")).toBeTruthy();
    expect(screen.getByText("مهمانان")).toBeTruthy();
    expect(screen.getByText("آمادگی ادامه")).toBeTruthy();
    expect(screen.getByText(/برای هر یک از ۲ واحد/)).toBeTruthy();
    expect(screen.getAllByText("۲").length).toBeGreaterThanOrEqual(2);
  });

  it("formats booking dates and countdowns with the Persian calendar and digits", () => {
    const range = formatBookingDateRange("2026-08-10", "2026-08-12");
    expect(range).toContain("۱۴۰۵");
    expect(range).not.toContain("2026");
    expect(formatBookingCountdown(3_661)).toBe("۰۱:۰۱:۰۱");
    expect(bookingModePresentation("OnRequest").label).toBe("نیازمند تأیید اقامتگاه");
  });

  it("rejects a different property, mode, and duplicate named room", () => {
    const first = item({ roomId: 101, roomName: "اتاق ۱۰۱" });
    const current = state([first]);
    expect(() => addItemsToBookingCart(current, [item({ propertyId: 2 })])).toThrow(/یک اقامتگاه/);
    expect(() => addItemsToBookingCart(current, [item({ bookingMode: "OnRequest" })])).toThrow(/ترکیب/);
    expect(() => addItemsToBookingCart(current, [item({ roomId: 101 })])).toThrow(/قبلاً/);
  });

  it("restores the cart and checkout intent from sessionStorage", async () => {
    const saved = { ...state([item()]), checkoutRequested: true };
    const { hydrated: _hydrated, ...stored } = saved;
    sessionStorage.setItem(bookingCartStorageKey, JSON.stringify(stored));
    function Probe() {
      const cart = useBookingCart();
      return <span>{cart.hydrated ? `${cart.items.length}:${cart.checkoutRequested}` : "loading"}</span>;
    }
    render(<BookingCartProvider><Probe /></BookingCartProvider>);
    expect(await screen.findByText("1:true")).toBeTruthy();
    expect(restoreBookingCart(sessionStorage.getItem(bookingCartStorageKey))?.idempotencyKey).toBe("stable-key");
  });

  it("revalidates availability and reports a changed price", async () => {
    const original = item();
    const result = await revalidateBookingCart([original], vi.fn().mockResolvedValue({
      propertyId: 1,
      propertyName: "خانه کاشان",
      propertySlug: "kashan-house",
      checkInDate: original.checkIn,
      checkOutDate: original.checkOut,
      adults: 2,
      children: 0,
      childAges: [],
      roomTypes: [{ roomTypeId: 10, name: "اتاق شاه‌نشین", englishName: null, inventoryMode: "TypeBasedInventory", availableCount: 2, bookingMode: "Instant", maxAdults: 2, maxChildren: 0, allowExtraGuest: false, maxExtraGuests: 0, nightsCount: 2, finalAmount: 2_500_000, currency: "IRR", rooms: [] }],
    }));
    expect(result.priceChanged).toBe(true);
    expect(result.items[0].displayAmount).toBe(2_500_000);
  });

  it("reports the actionable current limit when cart quantity exceeds revalidated availability", async () => {
    const originals = expandBookingCartSelection(selection({ quantity: 2 }));

    await expect(revalidateBookingCart(originals, vi.fn().mockResolvedValue({
      propertyId: 1,
      propertyName: "خانه کاشان",
      propertySlug: "kashan-house",
      checkInDate: originals[0].checkIn,
      checkOutDate: originals[0].checkOut,
      adults: 2,
      children: 0,
      childAges: [],
      roomTypes: [{ roomTypeId: 10, name: "اتاق شاه‌نشین", englishName: null, inventoryMode: "TypeBasedInventory", availableCount: 1, bookingMode: "Instant", maxAdults: 2, maxChildren: 0, allowExtraGuest: false, maxExtraGuests: 0, nightsCount: 2, finalAmount: 2_000_000, currency: "IRR", rooms: [] }],
    }))).rejects.toThrow(/حداکثر ۱ واحد در دسترس است/);
  });

  it("creates an idempotent safe payload without identity or status fields", async () => {
    const create = vi.fn().mockResolvedValue({ sessionCode: "BS-1" });
    await createBookingSessionFromCart([item()], "same-key", create);
    await createBookingSessionFromCart([item()], "same-key", create);
    expect(create).toHaveBeenCalledTimes(2);
    for (const [payload] of create.mock.calls) {
      expect(payload.idempotencyKey).toBe("same-key");
      expect(payload).not.toHaveProperty("clientId");
      expect(payload).not.toHaveProperty("guestId");
      expect(payload).not.toHaveProperty("propertyId");
      expect(payload.items[0]).not.toHaveProperty("status");
      expect(payload.items[0]).not.toHaveProperty("roomId");
    }
  });

  it("uses repeated childAges query parameters", async () => {
    const originalFetch = global.fetch;
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ roomTypes: [] }) }) as typeof fetch;
    await fetchBookingOptions("خانه", { checkIn: "2026-08-10", checkOut: "2026-08-12", adults: 2, children: 2, childAges: [4, 7] });
    const url = String(vi.mocked(global.fetch).mock.calls[0][0]);
    expect(url).toContain("childAges=4&childAges=7");
    global.fetch = originalFetch;
  });

  it("allows only safe internal auth return paths", () => {
    expect(safeInternalReturnTo("/properties/kashan?checkIn=2026-08-10")).toBe("/properties/kashan?checkIn=2026-08-10");
    expect(safeInternalReturnTo("//evil.example/path")).toBeNull();
    expect(safeInternalReturnTo("https://evil.example/path")).toBeNull();
  });

  it("renders an accessible RTL mobile action bar", () => {
    const onContinue = vi.fn();
    render(<BookingCartMobileActionBar count={2} loading={false} onContinue={onContinue} total={4_000_000} />);
    const bar = screen.getByTestId("booking-mobile-action-bar");
    expect(bar.getAttribute("dir")).toBe("rtl");
    fireEvent.click(screen.getByRole("button", { name: "ادامه رزرو" }));
    expect(onContinue).toHaveBeenCalledOnce();
  });
});
