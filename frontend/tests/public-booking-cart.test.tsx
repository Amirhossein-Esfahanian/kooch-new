import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const currency = vi.hoisted(() => ({ label: "تومان" }));

vi.mock("@/lib/currency", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/currency")>();
  return { ...actual, useSiteCurrencyLabel: () => currency.label };
});
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
  bookingCartOfferMatches,
  bookingCartItemsShareContext,
  bookingCartSelectionMatchesItems,
  bookingCartStorageKey,
  BookingCartProvider,
  expandStayNights,
  expandBookingCartSelection,
  getCartAwareAvailableCount,
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
  beforeEach(() => {
    currency.label = "تومان";
  });

  it("uses half-open stay nights", () => {
    expect(expandStayNights("2026-08-20", "2026-08-22")).toEqual([
      "2026-08-20",
      "2026-08-21",
    ]);
    expect(expandStayNights("2026-08-22", "2026-08-23")).toEqual(["2026-08-22"]);
  });

  it.each([
    {
      name: "blocks an overlapping stay when the only unit is already in the cart",
      items: [item({ checkIn: "2026-08-20", checkOut: "2026-08-22" })],
      checkIn: "2026-08-21",
      checkOut: "2026-08-22",
      serverAvailableCount: 1,
      expected: 0,
    },
    {
      name: "allows an adjacent non-overlapping stay",
      items: [item({ checkIn: "2026-08-20", checkOut: "2026-08-21" })],
      checkIn: "2026-08-21",
      checkOut: "2026-08-22",
      serverAvailableCount: 1,
      expected: 1,
    },
    {
      name: "limits additional quantity by overlapping cart demand",
      items: [item({ checkIn: "2026-08-20", checkOut: "2026-08-22" })],
      checkIn: "2026-08-21",
      checkOut: "2026-08-22",
      serverAvailableCount: 3,
      expected: 2,
    },
    {
      name: "aggregates multiple overlapping cart items per night",
      items: [
        item({ checkIn: "2026-08-20", checkOut: "2026-08-22" }),
        item({ checkIn: "2026-08-21", checkOut: "2026-08-23" }),
      ],
      checkIn: "2026-08-20",
      checkOut: "2026-08-23",
      serverAvailableCount: 3,
      expected: 1,
    },
    {
      name: "ignores a different RoomType",
      items: [item({ roomTypeId: 20, checkIn: "2026-08-20", checkOut: "2026-08-22" })],
      checkIn: "2026-08-20",
      checkOut: "2026-08-22",
      serverAvailableCount: 1,
      expected: 1,
    },
    {
      name: "ignores a different Property",
      items: [item({ propertyId: 2, checkIn: "2026-08-20", checkOut: "2026-08-22" })],
      checkIn: "2026-08-20",
      checkOut: "2026-08-22",
      serverAvailableCount: 1,
      expected: 1,
    },
    {
      name: "calculates partial overlaps per night instead of subtracting globally",
      items: [
        item({ checkIn: "2026-08-20", checkOut: "2026-08-21" }),
        item({ checkIn: "2026-08-22", checkOut: "2026-08-23" }),
      ],
      checkIn: "2026-08-21",
      checkOut: "2026-08-22",
      serverAvailableCount: 1,
      expected: 1,
    },
  ])("$name", ({ items, checkIn, checkOut, serverAvailableCount, expected }) => {
    expect(getCartAwareAvailableCount({
      items,
      propertyId: 1,
      roomTypeId: 10,
      checkIn,
      checkOut,
      serverAvailableCount,
    })).toBe(expected);
  });

  it("recalculates remaining capacity when the requested dates change", () => {
    const items = [item({ checkIn: "2026-08-20", checkOut: "2026-08-22" })];
    const remaining = (checkIn: string, checkOut: string) =>
      getCartAwareAvailableCount({
        items,
        propertyId: 1,
        roomTypeId: 10,
        checkIn,
        checkOut,
        serverAvailableCount: 1,
      });

    expect(remaining("2026-08-21", "2026-08-22")).toBe(0);
    expect(remaining("2026-08-22", "2026-08-23")).toBe(1);
  });

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

  it("normalizes omitted RatePlan identity and keeps base and explicit offers distinct", () => {
    const base = item();
    const explicit = item({ id: "plan-12", ratePlanId: 12, displayAmount: 1_700_000 });
    const otherPlan = item({ id: "plan-13", ratePlanId: 13, displayAmount: 1_800_000 });
    expect(base.ratePlanId).toBeNull();
    expect(bookingCartOfferMatches(base, 10, null)).toBe(true);
    expect(bookingCartOfferMatches(explicit, 10, 12)).toBe(true);
    expect(bookingCartOfferMatches(explicit, 10, 13)).toBe(false);
    expect(bookingCartOfferMatches(explicit, 10, null)).toBe(false);
    expect(groupBookingCartItems([base, explicit, otherPlan])).toHaveLength(3);
    expect(groupBookingCartItems([explicit, item({ id: "plan-12-again", ratePlanId: 12, displayAmount: 1_700_000 })])).toHaveLength(1);
    expect([base, explicit, otherPlan].filter((entry) => bookingCartOfferMatches(entry, 10, 12))).toHaveLength(1);
    expect(bookingCartItemsShareContext([base, explicit, otherPlan])).toBe(true);
    expect(addItemsToBookingCart(state([base]), [explicit]).items).toHaveLength(2);
  });

  it("keeps MealPlan display metadata out of offer identity and grouping", () => {
    const withMeal = item({ mealPlanName: "صبحانه شامل قیمت" });
    const withoutMeal = item({ id: "same-offer", mealPlanName: null });
    expect(bookingCartOfferMatches(withMeal, 10, null)).toBe(true);
    expect(bookingCartOfferMatches(withoutMeal, 10, null)).toBe(true);
    expect(groupBookingCartItems([withMeal, withoutMeal])).toHaveLength(1);
    expect(groupBookingCartItems([withMeal, withoutMeal])[0].total).toBe(4_000_000);
  });

  it("shares RoomType inventory across rate offers instead of multiplying capacity", () => {
    const items = [
      item({ ratePlanId: null }),
      item({ id: "plan-12-a", ratePlanId: 12 }),
      item({ id: "plan-12-b", ratePlanId: 12 }),
    ];
    expect(getCartAwareAvailableCount({
      items, propertyId: 1, roomTypeId: 10,
      checkIn: "2026-08-10", checkOut: "2026-08-12", serverAvailableCount: 3,
    })).toBe(0);
    expect(items.filter((entry) => bookingCartOfferMatches(entry, 10, 12))).toHaveLength(2);
  });

  it("names remove actions by RoomType, offer, and grouped quantity while removing only that bucket", () => {
    const onRemove = vi.fn();
    const items = [
      item({ id: "base", roomTypeName: "اتاق دبل", displayAmount: 2_000_000 }),
      item({
        id: "room-only-1",
        roomTypeName: "اتاق دبل",
        ratePlanId: 12,
        ratePlanName: "بدون صبحانه",
        displayAmount: 1_500_000,
      }),
      item({
        id: "room-only-2",
        roomTypeName: "اتاق دبل",
        ratePlanId: 12,
        ratePlanName: "بدون صبحانه",
        displayAmount: 1_500_000,
      }),
      item({
        id: "full-board",
        roomTypeName: "اتاق دبل",
        ratePlanId: 13,
        ratePlanName: "فول‌برد",
        displayAmount: 2_500_000,
      }),
    ];
    const view = render(
      <BookingCartSummary
        items={items}
        total={7_500_000}
        onRemove={onRemove}
      />,
    );
    const lines = screen.getAllByRole("listitem");
    expect(lines).toHaveLength(3);
    expect(
      within(lines[0]).getByRole("button", {
        name: "حذف ۱ واحد اتاق دبل - نرخ استاندارد از سبد رزرو",
      }),
    ).toBeTruthy();
    expect(
      within(lines[1]).getByRole("button", {
        name: "حذف ۲ واحد اتاق دبل - بدون صبحانه از سبد رزرو",
      }),
    ).toBeTruthy();
    expect(
      within(lines[2]).getByRole("button", {
        name: "حذف ۱ واحد اتاق دبل - فول‌برد از سبد رزرو",
      }),
    ).toBeTruthy();

    fireEvent.click(
      within(lines[1]).getByRole("button", {
        name: "حذف ۲ واحد اتاق دبل - بدون صبحانه از سبد رزرو",
      }),
    );
    expect(onRemove.mock.calls.map(([id]) => id)).toEqual(["room-only-1", "room-only-2"]);

    const removedIds = new Set(["room-only-1", "room-only-2"]);
    const remainingItems = items.filter((entry) => !removedIds.has(entry.id));
    view.rerender(
      <BookingCartSummary
        items={remainingItems}
        total={4_500_000}
        onRemove={onRemove}
      />,
    );
    const remainingLines = screen.getAllByRole("listitem");
    expect(remainingLines).toHaveLength(2);
    expect(within(remainingLines[0]).getByText("نرخ استاندارد")).toBeTruthy();
    expect(within(remainingLines[1]).getByText("فول‌برد")).toBeTruthy();
    expect(screen.getByText(/۴٬۵۰۰٬۰۰۰/)).toBeTruthy();
  });

  it("keeps remove labels safe for legacy explicit items without a stored offer name", () => {
    render(
      <BookingCartSummary
        items={[item({ id: "legacy-plan", ratePlanId: 21, ratePlanName: null })]}
        total={2_000_000}
        onRemove={vi.fn()}
      />,
    );
    const line = screen.getByRole("listitem");
    expect(
      within(line).getByRole("button", {
        name: "حذف ۱ واحد اتاق شاه‌نشین - نرخ انتخاب‌شده از سبد رزرو",
      }),
    ).toBeTruthy();
  });

  it("distinguishes the standard offer and two named RatePlans in the cart", () => {
    render(<BookingCartSummary items={[
      item({ id: "base" }),
      item({ id: "room-only", ratePlanId: 12, ratePlanName: "بدون صبحانه", mealPlanName: "Room Only", displayAmount: 1_700_000 }),
      item({ id: "full-board", ratePlanId: 13, ratePlanName: "فول‌برد", mealPlanName: "سه وعده غذا", displayAmount: 2_300_000 }),
    ]} total={6_000_000} />);
    const lines = screen.getAllByRole("listitem");
    expect(lines).toHaveLength(3);
    expect(within(lines[0]).getByText("نرخ استاندارد")).toBeTruthy();
    expect(within(lines[1]).getByText("بدون صبحانه · Room Only")).toBeTruthy();
    expect(within(lines[2]).getByText("فول‌برد · سه وعده غذا")).toBeTruthy();
    expect(within(lines[1]).getByText(/۱٬۷۰۰٬۰۰۰/)).toBeTruthy();
    expect(within(lines[2]).getByText(/۲٬۳۰۰٬۰۰۰/)).toBeTruthy();
  });

  it("shows the standard meal when present and no inherited meal on a null-meal RatePlan", () => {
    render(<BookingCartSummary items={[
      item({ id: "base", mealPlanName: "صبحانه شامل قیمت" }),
      item({ id: "explicit", ratePlanId: 12, ratePlanName: "بدون صبحانه", mealPlanName: null }),
    ]} total={4_000_000} />);
    const lines = screen.getAllByRole("listitem");
    expect(within(lines[0]).getByText("نرخ استاندارد · صبحانه شامل قیمت")).toBeTruthy();
    expect(within(lines[1]).getByText("بدون صبحانه")).toBeTruthy();
    expect(within(lines[1]).queryByText(/صبحانه شامل قیمت/)).toBeNull();
  });

  it("renders Jalali dates, Persian numbers, booking mode, and the cart summary", () => {
    const items = expandBookingCartSelection(selection({
      childAges: [7],
      children: 1,
      quantity: 2,
    }));
    render(
      <BookingCartSummary
        items={items}
        loading={false}
        onContinue={vi.fn()}
        onRemove={vi.fn()}
        total={4_000_000}
      />,
    );

    expect(screen.getByRole("heading", { name: "انتخاب‌های شما" })).toBeTruthy();
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    expect(screen.getAllByText(/۱۴۰۵/).length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText(/2026-08/)).toBeNull();
    expect(screen.getAllByText("رزرو آنی").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("تعداد نوع اتاق")).toBeTruthy();
    expect(screen.getByText("تعداد اتاق")).toBeTruthy();
    expect(screen.getByText("مبلغ کل")).toBeTruthy();
    expect(screen.getByText(/۲ شب · ۲ بزرگسال · ۱ کودک/)).toBeTruthy();
    expect(screen.getAllByText("۲").length).toBeGreaterThanOrEqual(1);
  });

  it("keeps an empty Your Choices summary visible without an active continuation", () => {
    render(
      <BookingCartSummary
        items={[]}
        loading={false}
        onContinue={vi.fn()}
        onRemove={vi.fn()}
        total={0}
      />,
    );

    expect(screen.getByRole("heading", { name: "انتخاب‌های شما" })).toBeTruthy();
    expect(screen.getByText("هنوز اتاقی انتخاب نکرده‌اید.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "ادامه رزرو" })).toBeNull();
  });

  it("shows two RoomTypes, their subtotals, and the combined live total", () => {
    currency.label = "ریال آزمایشی";
    const items = [
      item(),
      item({
        id: "second-room-type",
        roomTypeId: 20,
        roomTypeName: "اتاق نیلوفر",
        displayAmount: 3_000_000,
      }),
    ];
    render(
      <BookingCartSummary
        items={items}
        loading={false}
        onContinue={vi.fn()}
        onRemove={vi.fn()}
        total={5_000_000}
      />,
    );

    const summary = screen.getByTestId("booking-choices-summary");
    expect(within(summary).getByText("اتاق شاه‌نشین")).toBeTruthy();
    expect(within(summary).getByText("اتاق نیلوفر")).toBeTruthy();
    expect(within(summary).getByText(/۲٬۰۰۰٬۰۰۰ ریال آزمایشی/)).toBeTruthy();
    expect(within(summary).getByText(/۳٬۰۰۰٬۰۰۰ ریال آزمایشی/)).toBeTruthy();
    expect(within(summary).getByText("۵٬۰۰۰٬۰۰۰ ریال آزمایشی")).toBeTruthy();
    expect(within(summary).getAllByText("۲").length).toBeGreaterThanOrEqual(2);
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

  it("establishes one stay context and allows multiple room types and quantities within it", () => {
    const firstItems = expandBookingCartSelection(selection({ quantity: 2 }));
    const established = addItemsToBookingCart(state(), firstItems);
    const secondRoomType = item({
      roomTypeId: 20,
      roomTypeName: "اتاق دوقلو",
      displayAmount: 1_500_000,
    });

    const combined = addItemsToBookingCart(established, [secondRoomType]);

    expect(combined.items).toHaveLength(3);
    expect(new Set(combined.items.map((entry) => entry.roomTypeId))).toEqual(new Set([10, 20]));
    expect(bookingCartItemsShareContext(combined.items)).toBe(true);
  });

  it("rejects partial date overlap and a changed guest composition", () => {
    const current = state([item()]);

    expect(() => addItemsToBookingCart(current, [item({
      checkIn: "2026-08-11",
      checkOut: "2026-08-12",
    })])).toThrow(/یک تاریخ اقامت/);
    expect(() => addItemsToBookingCart(current, [item({
      adults: 1,
      children: 1,
      childAges: [7],
    })])).toThrow(/ترکیب مهمان/);
    expect(bookingCartSelectionMatchesItems(current.items, {
      propertyId: 1,
      checkIn: "2026-08-10",
      checkOut: "2026-08-12",
      adults: 2,
      children: 0,
      childAges: [],
    })).toBe(true);
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

  it("restores legacy stored selections without RatePlanId as the base offer", () => {
    const saved = { ...state([item()]), checkoutRequested: true };
    const { hydrated: _hydrated, ...stored } = saved;
    const legacy = JSON.parse(JSON.stringify(stored));
    delete legacy.items[0].ratePlanId;
    delete legacy.items[0].mealPlanName;
    const restored = restoreBookingCart(JSON.stringify(legacy));
    expect(restored?.items[0].ratePlanId).toBeNull();
    expect(restored?.items[0].mealPlanName).toBeUndefined();
  });

  it("rejects an inconsistent legacy cart instead of mixing stay contexts", () => {
    const stored = {
      propertyId: 1,
      propertyName: "خانه کاشان",
      propertySlug: "kashan-house",
      bookingMode: "Instant",
      idempotencyKey: "legacy-key",
      checkoutRequested: false,
      items: [
        item(),
        item({ id: "legacy-second", checkIn: "2026-08-11", checkOut: "2026-08-13" }),
      ],
    };

    expect(restoreBookingCart(JSON.stringify(stored))).toBeNull();
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

  it("revalidates the selected RatePlan quote while enforcing shared RoomType inventory", async () => {
    const items = [item({ id: "base", ratePlanId: null }), item({ id: "plan", ratePlanId: 12, displayAmount: 1_700_000 })];
    const fetcher = vi.fn().mockResolvedValue({
      propertyId: 1,
      roomTypes: [{ roomTypeId: 10, name: "اتاق شاه‌نشین", availableCount: 2, bookingMode: "Instant",
        defaultMealPlanName: "صبحانه شامل قیمت",
        finalAmount: 2_000_000, currency: "IRR", rooms: [],
        ratePlans: [{ ratePlanId: 12, name: "بدون صبحانه", mealPlanName: "Room Only", finalAmount: 1_600_000, currency: "IRR" }] }],
    });
    const result = await revalidateBookingCart(items, fetcher);
    expect(fetcher).toHaveBeenCalledOnce();
    expect(result.priceChanged).toBe(true);
    expect(result.items.map((entry) => entry.displayAmount)).toEqual([2_000_000, 1_600_000]);
    expect(result.items.map((entry) => entry.ratePlanId)).toEqual([null, 12]);
    expect(result.items[0].mealPlanName).toBe("صبحانه شامل قیمت");
    expect(result.items[1].ratePlanName).toBe("بدون صبحانه");
    expect(result.items[1].mealPlanName).toBe("Room Only");

    await expect(revalidateBookingCart([...items, item({ id: "third", ratePlanId: 13 })], fetcher))
      .rejects.toThrow(/حداکثر ۲ واحد/);
  });

  it("revalidates an explicit plan with no meal without borrowing the standard meal", async () => {
    const fetcher = vi.fn().mockResolvedValue({
      propertyId: 1,
      roomTypes: [{
        roomTypeId: 10, name: "اتاق شاه‌نشین", availableCount: 1,
        bookingMode: "Instant", finalAmount: 2_000_000, currency: "IRR", rooms: [],
        defaultMealPlanName: "صبحانه شامل قیمت",
        ratePlans: [{
          ratePlanId: 12, name: "بدون صبحانه", mealPlanName: null,
          finalAmount: 2_000_000, currency: "IRR",
        }],
      }],
    });
    const result = await revalidateBookingCart([
      item({ ratePlanId: 12, ratePlanName: "بدون صبحانه", mealPlanName: "قدیمی" }),
    ], fetcher);
    expect(result.items[0].mealPlanName).toBeNull();
  });

  it("rejects an explicit plan missing from current backend options", async () => {
    await expect(revalidateBookingCart([item({ ratePlanId: 12 })], vi.fn().mockResolvedValue({
      propertyId: 1,
      roomTypes: [{ roomTypeId: 10, name: "اتاق شاه‌نشین", availableCount: 1, bookingMode: "Instant",
        finalAmount: 2_000_000, currency: "IRR", rooms: [], ratePlans: [] }],
    }))).rejects.toThrow(/نرخ فروش انتخاب‌شده/);
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

  it("revalidates a multi-room cart through the combined quote and preserves per-room allocation", async () => {
    const items = [
      item({ id: "room-a", adults: 4, stayRooms: 2, allocatedAdults: 2,
        allocatedChildAges: [], displayAmount: 2_000_000 }),
      item({ id: "room-b", adults: 4, stayRooms: 2, roomTypeId: 20,
        ratePlanId: 12, allocatedAdults: 2, allocatedChildAges: [],
        displayAmount: 3_000_000 }),
    ];
    const legacyFetcher = vi.fn();
    const quoteFetcher = vi.fn().mockResolvedValue({
      propertyId: 1, checkInDate: "2026-08-10", checkOutDate: "2026-08-12",
      adults: 4, childAges: [], totalAmount: 5_500_000, currency: "IRR",
      rooms: [
        { selectedRoomIndex: 0, roomTypeId: 10, ratePlanId: null, adults: 2,
          childAges: [], bookingMode: "Instant", finalAmount: 2_500_000, currency: "IRR" },
        { selectedRoomIndex: 1, roomTypeId: 20, ratePlanId: 12, adults: 2,
          childAges: [], bookingMode: "Instant", finalAmount: 3_000_000, currency: "IRR" },
      ],
    });
    const result = await revalidateBookingCart(items, legacyFetcher, quoteFetcher);
    expect(legacyFetcher).not.toHaveBeenCalled();
    expect(quoteFetcher).toHaveBeenCalledWith("kashan-house", {
      checkInDate: "2026-08-10", checkOutDate: "2026-08-12", adults: 4,
      childAges: [], selections: [
        { roomTypeId: 10, ratePlanId: null, quantity: 1 },
        { roomTypeId: 20, ratePlanId: 12, quantity: 1 },
      ],
    });
    expect(result.priceChanged).toBe(true);
    expect(result.items.map((entry) => entry.displayAmount)).toEqual([2_500_000, 3_000_000]);
    expect(result.items.map((entry) => entry.allocatedAdults)).toEqual([2, 2]);
  });

  it("sends one stay-level party and repeated rate-plan room items without duplicating children", async () => {
    const create = vi.fn().mockResolvedValue({ sessionCode: "BS-MULTI" });
    const items = [
      item({ id: "first", stayRooms: 2, adults: 4, children: 1, childAges: [7],
        allocatedAdults: 2, allocatedChildAges: [7], ratePlanId: 12 }),
      item({ id: "second", stayRooms: 2, adults: 4, children: 1, childAges: [7],
        allocatedAdults: 2, allocatedChildAges: [], ratePlanId: 12 }),
    ];
    await createBookingSessionFromCart(items, "stable-multi-key", {
      bookingForSelf: true, primaryGuest: null, expectedArrivalTime: null,
      expectedArrivalDayOffset: null, specialRequest: null,
    }, create);
    const [payload] = create.mock.calls[0];
    expect(payload.idempotencyKey).toBe("stable-multi-key");
    expect(payload.stayGuests).toEqual({ adults: 4, childAges: [7] });
    expect(payload.items).toHaveLength(2);
    expect(payload.items.map((entry: { ratePlanId: number }) => entry.ratePlanId)).toEqual([12, 12]);
    expect(payload.items.every((entry: { adults: number; children: number; childAges: number[] }) =>
      entry.adults === 1 && entry.children === 0 && entry.childAges.length === 0)).toBe(true);
  });

  it("blocks an incomplete multi-room cart before quote or BookingSession creation", async () => {
    const partial = [item({ stayRooms: 2, adults: 4, allocatedAdults: 2,
      allocatedChildAges: [] })];
    const quoteFetcher = vi.fn();
    await expect(revalidateBookingCart(partial, vi.fn(), quoteFetcher))
      .rejects.toThrow(/کامل نیست/);
    expect(quoteFetcher).not.toHaveBeenCalled();
    const create = vi.fn();
    expect(() => createBookingSessionFromCart(partial, "key", {
      bookingForSelf: true, primaryGuest: null, expectedArrivalTime: null,
      expectedArrivalDayOffset: null, specialRequest: null,
    }, create)).toThrow(/کامل نیست/);
    expect(create).not.toHaveBeenCalled();
  });

  it("creates an idempotent safe payload whose independent children share one stay context", async () => {
    const create = vi.fn().mockResolvedValue({ sessionCode: "BS-1" });
    const items = [item({ mealPlanName: "صبحانه شامل قیمت" }), item({ id: "second-room", roomTypeId: 20, roomTypeName: "اتاق دوقلو" })];
    const stayDetails = {
      bookingForSelf: false,
      primaryGuest: {
        firstName: "مریم",
        lastName: "کریمی",
        mobile: null,
        email: "guest@example.test",
      },
      expectedArrivalTime: "14:30:00",
      expectedArrivalDayOffset: 0 as const,
      specialRequest: "اتاق آرام لطفاً",
    };
    await createBookingSessionFromCart(items, "same-key", stayDetails, create);
    await createBookingSessionFromCart(items, "same-key", stayDetails, create);
    expect(create).toHaveBeenCalledTimes(2);
    for (const [payload] of create.mock.calls) {
      expect(payload.idempotencyKey).toBe("same-key");
      expect(payload).not.toHaveProperty("clientId");
      expect(payload).not.toHaveProperty("guestId");
      expect(payload).not.toHaveProperty("propertyId");
      expect(payload.bookingForSelf).toBe(false);
      expect(payload.primaryGuest).toEqual(stayDetails.primaryGuest);
      expect(payload.primaryGuest).not.toHaveProperty("nationalCode");
      expect(payload.expectedArrivalTime).toBe("14:30:00");
      expect(payload.expectedArrivalDayOffset).toBe(0);
      expect(payload.specialRequest).toBe("اتاق آرام لطفاً");
      expect(payload.items[0]).not.toHaveProperty("status");
      expect(payload.items[0]).not.toHaveProperty("roomId");
      expect(payload.items[0].notes).toBeNull();
      expect(payload.items[0].ratePlanId).toBeNull();
      expect(payload.items[0]).not.toHaveProperty("mealPlanName");
      expect(payload.items).toHaveLength(2);
      expect(payload.items.every((entry: { checkInDate: string; checkOutDate: string; adults: number }) =>
        entry.checkInDate === "2026-08-10" &&
        entry.checkOutDate === "2026-08-12" &&
        entry.adults === 2,
      )).toBe(true);
    }
  });

  it("sends only explicit RatePlan identity, never modifier or meal metadata", async () => {
    const create = vi.fn().mockResolvedValue({ sessionCode: "O-123456" });
    const stayDetails = { bookingForSelf: true, primaryGuest: null, expectedArrivalTime: null, expectedArrivalDayOffset: null, specialRequest: null };
    await createBookingSessionFromCart([item({ ratePlanId: 12 })], "key", stayDetails, create);
    const [payload] = create.mock.calls[0];
    expect(payload.items[0].ratePlanId).toBe(12);
    expect(payload.items[0]).not.toHaveProperty("priceModifierValue");
    expect(payload.items[0]).not.toHaveProperty("mealPlanId");
    expect(payload.items[0]).not.toHaveProperty("ratePlanName");
  });

  it("serializes an optional primary guest national code without changing legacy fields", async () => {
    const create = vi.fn().mockResolvedValue({ sessionCode: "BS-NATIONAL" });
    const stayDetails = {
      bookingForSelf: false,
      primaryGuest: {
        firstName: "مریم",
        lastName: "کریمی",
        mobile: "09121234567",
        email: null,
        nationalCode: "  ۱۲۳۴۵۶۷۸۹۰  ",
      },
      expectedArrivalTime: null,
      expectedArrivalDayOffset: null,
      specialRequest: null,
    };

    await createBookingSessionFromCart([item()], "national-code-key", stayDetails, create);

    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      bookingForSelf: false,
      primaryGuest: stayDetails.primaryGuest,
    }));
  });

  it("supports the existing primaryGuest contract for a self guest national code", async () => {
    const create = vi.fn().mockResolvedValue({ sessionCode: "BS-SELF-NATIONAL" });
    const primaryGuest = {
      firstName: null,
      lastName: null,
      mobile: null,
      email: null,
      nationalCode: "1234567890",
    };

    await createBookingSessionFromCart([item()], "self-national-code-key", {
      bookingForSelf: true,
      primaryGuest,
      expectedArrivalTime: null,
      expectedArrivalDayOffset: null,
      specialRequest: null,
    }, create);

    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      bookingForSelf: true,
      primaryGuest,
    }));
  });

  it("forwards editable linked-guest fields for a self booking without account identifiers", async () => {
    const create = vi.fn().mockResolvedValue({ sessionCode: "BS-SELF-GUEST" });
    const primaryGuest = {
      firstName: "مریم",
      lastName: "کریمی",
      mobile: "09121234567",
      email: "guest@example.test",
      nationalCode: "1234567890",
    };

    await createBookingSessionFromCart([item()], "self-guest-key", {
      bookingForSelf: true,
      primaryGuest,
      expectedArrivalTime: null,
      expectedArrivalDayOffset: null,
      specialRequest: null,
    }, create);

    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      bookingForSelf: true,
      primaryGuest,
    }));
    const [payload] = create.mock.calls[0];
    expect(payload).not.toHaveProperty("userId");
    expect(payload).not.toHaveProperty("guestId");
  });

  it("serializes one child age as one CSV query parameter", async () => {
    const originalFetch = global.fetch;
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ roomTypes: [] }) }) as typeof fetch;
    await fetchBookingOptions("خانه", { checkIn: "2026-08-10", checkOut: "2026-08-12", adults: 2, children: 1, childAges: [5] });
    const url = new URL(String(vi.mocked(global.fetch).mock.calls[0][0]), "http://localhost");
    expect(url.searchParams.getAll("childAges")).toEqual(["5"]);
    expect(url.searchParams.get("checkIn")).toBe("2026-08-10");
    expect(url.searchParams.get("checkOut")).toBe("2026-08-12");
    expect(url.searchParams.get("adults")).toBe("2");
    expect(url.searchParams.get("children")).toBe("1");
    global.fetch = originalFetch;
  });

  it("serializes multiple child ages once in order and preserves the decoded comma", async () => {
    const originalFetch = global.fetch;
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ roomTypes: [] }) }) as typeof fetch;
    await fetchBookingOptions("خانه", { checkIn: "2026-08-10", checkOut: "2026-08-12", adults: 2, children: 3, childAges: [5, 8, 12] });
    const url = new URL(String(vi.mocked(global.fetch).mock.calls[0][0]), "http://localhost");
    expect(url.searchParams.getAll("childAges")).toEqual(["5,8,12"]);
    expect(url.search).toContain("childAges=5%2C8%2C12");
    expect(url.searchParams.get("children")).toBe("3");
    global.fetch = originalFetch;
  });

  it("omits childAges when there are no children", async () => {
    const originalFetch = global.fetch;
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ roomTypes: [] }) }) as typeof fetch;
    await fetchBookingOptions("خانه", { checkIn: "2026-08-10", checkOut: "2026-08-12", adults: 2, children: 0, childAges: [] });
    const url = new URL(String(vi.mocked(global.fetch).mock.calls[0][0]), "http://localhost");
    expect(url.searchParams.has("childAges")).toBe(false);
    expect(url.searchParams.get("children")).toBe("0");
    global.fetch = originalFetch;
  });

  it("allows only safe internal auth return paths", () => {
    expect(safeInternalReturnTo("/properties/kashan?checkIn=2026-08-10")).toBe("/properties/kashan?checkIn=2026-08-10");
    expect(safeInternalReturnTo("//evil.example/path")).toBeNull();
    expect(safeInternalReturnTo("https://evil.example/path")).toBeNull();
  });

  it("renders an accessible RTL mobile action bar", () => {
    currency.label = "ریال آزمایشی";
    const onContinue = vi.fn();
    render(<BookingCartMobileActionBar count={2} loading={false} onContinue={onContinue} total={4_000_000} />);
    const bar = screen.getByTestId("booking-mobile-action-bar");
    expect(bar.getAttribute("dir")).toBe("rtl");
    expect(within(bar).getByText("۴٬۰۰۰٬۰۰۰ ریال آزمایشی")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "ادامه رزرو" }));
    expect(onContinue).toHaveBeenCalledOnce();
  });
});
