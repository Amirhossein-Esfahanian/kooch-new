import { useState } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { GuestSelector, type GuestSelectorValue } from "@/components/GuestSelector";
import { BookingCartSummary, type BookingCartDraft } from "@/components/booking/BookingCart";
import { PublicRoomTypeCard, type PublicRoomTypeCandidateBookingState } from "@/components/booking/PublicRoomTypeCard";
import type { PublicRoomType } from "@/lib/public-properties";
import type { PublicBookingRoomTypeCandidate } from "@/lib/booking-sessions";

vi.mock("@/lib/currency", async (original) => ({
  ...await original<typeof import("@/lib/currency")>(), useSiteCurrencyLabel: () => "تومان",
}));

function GuestForm() {
  const [guests, setGuests] = useState<GuestSelectorValue>({ rooms: 1, adults: 1, children: 0, childAges: [] });
  return <><GuestSelector maxChildren={2} onChange={setGuests} value={guests} /><button type="button">بیرون از انتخابگر</button></>;
}

const room: PublicRoomType = {
  id: 10, name: "اتاق باغ", englishName: null, roomKind: "Double", roomKindCode: "Double",
  description: "نمای باغ", basePrice: null, availabilityPrice: null, displayPrice: null,
  availabilityStatus: null, inventoryMode: "TypeBasedInventory", totalInventory: 3,
  maxAdults: 2, maxChildren: 1, allowExtraGuest: false, maxExtraGuests: 0, notes: null,
  floorNumber: null, stairCount: null, hasWindow: true, hasPrivateBathroom: true,
  bedInformation: [], images: [], amenities: [],
};
const candidate: PublicBookingRoomTypeCandidate = {
  roomTypeId: 10, name: room.name, roomKind: "Double", inventoryMode: "TypeBasedInventory",
  availableCount: 3, bookingMode: "Instant" as const, maxAdults: 2, maxChildren: 1,
  allowExtraGuest: false, maxExtraGuests: 0, defaultMealPlanName: null, defaultMealPlanSlug: null,
  rooms: [], ratePlans: [],
};

function RoomCard({ booking }: { booking: PublicRoomTypeCandidateBookingState }) {
  return <PublicRoomTypeCard candidateBooking={booking} galleryFallback="" onShowCalendar={vi.fn()} onShowDetails={vi.fn()} roomType={room} />;
}

function QuantityForm({ capacity = 3 }: { capacity?: number }) {
  const [quantity, setQuantity] = useState(0);
  return <><RoomCard booking={{ option: { ...candidate, availableCount: capacity },
    availableToAdd: capacity - quantity, selectedQuantity: quantity, totalSelectedQuantity: quantity,
    onAdd: () => setQuantity((value) => value + 1), onRemove: () => setQuantity((value) => value - 1), ratePlans: [],
  }} /><button type="button">کنترل دیگر</button></>;
}

describe("shared booking accessibility", () => {
  it("marks only the primary room-selection action, preserving outline and counter controls", () => {
    const booking: PublicRoomTypeCandidateBookingState = { option: candidate, availableToAdd: 3,
      selectedQuantity: 0, totalSelectedQuantity: 0, onAdd: vi.fn(), onRemove: vi.fn(), ratePlans: [] };
    const view = render(<RoomCard booking={booking} />);
    expect(screen.getByRole("button", { name: "انتخاب اتاق باغ" }).getAttribute("data-booking-primary")).toBe("true");
    expect(screen.getByRole("button", { name: /جزئیات/ }).hasAttribute("data-booking-primary")).toBe(false);
    view.rerender(<RoomCard booking={{ ...booking, availableToAdd: 0 }} />);
    const soldOut = screen.getByRole("button", { name: "تکمیل ظرفیت اتاق باغ" });
    expect(soldOut.hasAttribute("disabled")).toBe(true);
    expect(soldOut.hasAttribute("data-booking-primary")).toBe(false);
    view.rerender(<RoomCard booking={{ ...booking, availableToAdd: 2, selectedQuantity: 1, totalSelectedQuantity: 1 }} />);
    expect(screen.getByRole("button", { name: "افزایش تعداد اتاق باغ" }).hasAttribute("data-booking-primary")).toBe(false);
    expect(screen.getByRole("button", { name: "کاهش تعداد اتاق باغ" }).hasAttribute("data-booking-primary")).toBe(false);
  });
  it("labels room/adult/child groups and counter actions, announces counts and preserves limits", () => {
    render(<GuestForm />);
    fireEvent.click(screen.getByRole("button", { name: /مسافران:/ }));
    for (const title of ["تعداد اتاق", "بزرگسال", "کودک"]) {
      const group = screen.getByRole("group", { name: title });
      const decrease = within(group).getByRole("button", { name: `کاهش ${title}` });
      expect(decrease.hasAttribute("disabled")).toBe(true);
      fireEvent.click(decrease);
      const increase = within(group).getByRole("button", { name: `افزایش ${title}` });
      fireEvent.click(increase);
      const count = within(group).getByRole("status", { name: title });
      expect(count.textContent).toBe(title === "کودک" ? "۱" : "۲");
      expect(count.getAttribute("aria-live")).toBe("polite");
    }
    fireEvent.click(screen.getByRole("button", { name: "افزایش کودک" }));
    expect(screen.getByRole("button", { name: "افزایش کودک" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByLabelText("سن کودک ۱")).toBeTruthy();
    expect(screen.getByLabelText("سن کودک ۲")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "افزایش کودک" }));
    expect(screen.getByRole("status", { name: "کودک" }).textContent).toBe("۲");
    expect(screen.getByRole("group", { name: "انتخاب مسافران و اتاق‌ها" }).getAttribute("dir")).toBe("rtl");
  });

  it("closes on Escape and restores the trigger without discarding guest edits", () => {
    render(<GuestForm />);
    const trigger = screen.getByRole("button", { name: /مسافران:/ });
    trigger.focus();
    fireEvent.click(trigger);
    const increase = screen.getByRole("button", { name: "افزایش بزرگسال" });
    increase.focus();
    fireEvent.click(increase);
    fireEvent.keyDown(increase, { key: "Escape" });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(trigger);
    expect(screen.queryByRole("group", { name: "بزرگسال" })).toBeNull();
    fireEvent.click(trigger);
    expect(screen.getByRole("status", { name: "بزرگسال" }).textContent).toBe("۲");
    expect(document.getElementById(trigger.getAttribute("aria-controls")!)).toBeTruthy();
  });

  it("keeps outside-click focus at its destination", () => {
    render(<GuestForm />);
    fireEvent.click(screen.getByRole("button", { name: /مسافران:/ }));
    const outside = screen.getByRole("button", { name: "بیرون از انتخابگر" });
    outside.focus();
    fireEvent.pointerDown(outside);
    expect(document.activeElement).toBe(outside);
    expect(screen.queryByRole("group", { name: "بزرگسال" })).toBeNull();
  });

  it.each([1, 3])("restores logical focus across add/remove replacement with capacity %i", (capacity) => {
    render(<QuantityForm capacity={capacity} />);
    const add = screen.getByRole("button", { name: "انتخاب اتاق باغ" });
    add.focus();
    fireEvent.click(add);
    const remove = screen.getByRole("button", { name: capacity === 1 ? "حذف انتخاب اتاق باغ" : "کاهش تعداد اتاق باغ" });
    expect(document.activeElement).toBe(remove);
    fireEvent.click(remove);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "انتخاب اتاق باغ" }));
  });

  it("does not steal focus for an unfocused programmatic selection", () => {
    render(<QuantityForm />);
    const outside = screen.getByRole("button", { name: "کنترل دیگر" });
    outside.focus();
    fireEvent.click(screen.getByRole("button", { name: "انتخاب اتاق باغ" }));
    expect(document.activeElement).toBe(outside);
  });

  it("distinguishes a reached request limit from exhausted inventory and preserves OnRequest labeling", () => {
    const booking = { option: candidate, availableToAdd: 0, selectionLimitReached: true,
      selectedQuantity: 0, totalSelectedQuantity: 0, onAdd: vi.fn(), onRemove: vi.fn(), ratePlans: [] };
    const view = render(<RoomCard booking={booking} />);
    const limited = screen.getByRole("button", { name: "تعداد اتاق درخواستی تکمیل است اتاق باغ" });
    expect(limited.hasAttribute("disabled")).toBe(true);
    expect(screen.queryByText("تکمیل ظرفیت")).toBeNull();
    fireEvent.click(limited);
    expect(booking.onAdd).not.toHaveBeenCalled();
    view.rerender(<RoomCard booking={{ ...booking, selectionLimitReached: false,
      option: { ...candidate, availableCount: 0, bookingMode: "OnRequest" } }} />);
    expect(screen.getByRole("button", { name: "تکمیل ظرفیت اتاق باغ" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByText("نیازمند تأیید اقامتگاه")).toBeTruthy();
  });
});

describe("draft booking summary", () => {
  it.each(["partial", "pending", "error", "unconfirmed"] as const)("shows selections without any quoted amount in the %s state", (status) => {
    const onContinue = vi.fn();
    const draft: BookingCartDraft = { requestedRooms: 3, status, selections: [
      { roomTypeId: 10, roomTypeName: "اتاق باغ", ratePlanId: null, ratePlanName: null, quantity: 1 },
      { roomTypeId: 20, roomTypeName: "سوئیت", ratePlanId: 7, ratePlanName: "با صبحانه", quantity: 1 },
    ] };
    render(<BookingCartSummary draft={draft} items={[]} onContinue={onContinue} total={999999} />);
    const summary = screen.getByTestId("booking-choices-summary");
    expect(within(summary).getByText("اتاق باغ")).toBeTruthy();
    expect(within(summary).getByText("سوئیت")).toBeTruthy();
    expect(within(summary).getByText("با صبحانه")).toBeTruthy();
    expect(within(summary).getByText("در انتظار بررسی قیمت")).toBeTruthy();
    expect(summary.textContent).not.toMatch(/تومان|مبلغ کل|۹۹۹/);
    const button = within(summary).getByRole("button", { name: "ادامه رزرو" });
    expect(button.getAttribute("data-booking-primary")).toBe("true");
    expect(button.hasAttribute("disabled")).toBe(true);
    fireEvent.click(button);
    expect(onContinue).not.toHaveBeenCalled();
    if (status === "partial") expect(summary.textContent).toContain("۲ از ۳ اتاق");
    if (status === "pending") expect(summary.getAttribute("aria-busy")).toBe("true");
    if (status === "error") expect(summary.textContent).toContain("بررسی قیمت انجام نشد");
  });
});
