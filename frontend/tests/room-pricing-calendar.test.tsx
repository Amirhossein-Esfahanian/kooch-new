import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  RoomPricingCalendar,
  type RoomPricingCalendarRoom,
} from "@/components/pricing/RoomPricingCalendar";

const days: RoomPricingCalendarRoom["days"] = [
  {
    date: "2026-10-10", dayLabel: "۱۸", dateLabel: "۱۴۰۵/۰۷/۱۸",
    priceLabel: "۳٬۰۰۰", priceAccessibleLabel: "۳٬۰۰۰٬۰۰۰ تومان",
    availableUnits: 2, totalInventory: 3, status: "Available", isSelected: true,
  },
  {
    date: "2026-10-11", dayLabel: "۱۹", dateLabel: "۱۴۰۵/۰۷/۱۹",
    priceLabel: "—", priceAccessibleLabel: "۰ تومان",
    availableUnits: 1, totalInventory: 3, status: "OnRequest",
  },
  {
    date: "2026-10-12", dayLabel: "۲۰", dateLabel: "۱۴۰۵/۰۷/۲۰",
    priceLabel: "—", priceAccessibleLabel: "۰ تومان",
    availableUnits: 0, totalInventory: 3, status: "Unavailable", isPast: true,
  },
];

describe("shared RoomType pricing calendar presentation", () => {
  it("keeps Saturday-Friday headers, leading offset, price and inventory display", () => {
    render(<RoomPricingCalendar monthTitle="مهر ۱۴۰۵" rooms={[{ id: 7, name: "اتاق تست", days }]} startOffset={2} />);

    const room = screen.getByText("اتاق تست").closest("section")!;
    expect(screen.getByRole("heading", { name: "مهر ۱۴۰۵" })).toBeTruthy();
    expect(within(room).getByText("شنبه")).toBeTruthy();
    expect(within(room).getByText("جمعه")).toBeTruthy();
    expect(room.querySelectorAll('[aria-hidden="true"].min-h-16')).toHaveLength(2);
    expect(within(room).getByText("۳٬۰۰۰")).toBeTruthy();
    expect(within(room).getByText("۲/۳")).toBeTruthy();
    expect(within(room).getByText("۱/۳")).toBeTruthy();
  });

  it("preserves available, on-request and unavailable surfaces", () => {
    render(<RoomPricingCalendar rooms={[{ id: 7, name: "اتاق تست", days }]} startOffset={0} />);

    expect(screen.getByRole("group", { name: /۱۴۰۵\/۰۷\/۱۸/ }).className).toContain("--theme-success-soft");
    expect(screen.getByRole("group", { name: /۱۴۰۵\/۰۷\/۱۹/ }).className).toContain("--theme-warning-soft");
    expect(screen.getByRole("group", { name: /۱۴۰۵\/۰۷\/۲۰/ }).className).toContain("bg-muted");
  });

  it("is read-only without an interaction callback or selection affordances", () => {
    render(<RoomPricingCalendar rooms={[{ id: 7, name: "اتاق تست", days }]} startOffset={0} />);

    expect(screen.queryByRole("button")).toBeNull();
    const day = screen.getByRole("group", { name: /۱۴۰۵\/۰۷\/۱۸/ });
    expect(day.hasAttribute("aria-pressed")).toBe(false);
    expect(day.className).not.toContain("ring-primary");
  });

  it("keeps keyboard-capable buttons, pressed state, disabled past dates and callbacks for management", () => {
    const onDaySelect = vi.fn();
    render(<RoomPricingCalendar rooms={[{ id: 7, name: "اتاق تست", days, onDaySelect }]} startOffset={0} />);

    const selected = screen.getByRole("button", { name: /۱۴۰۵\/۰۷\/۱۸/ });
    expect(selected.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(selected);
    expect(onDaySelect).toHaveBeenCalledWith("2026-10-10");
    expect((screen.getByRole("button", { name: /۱۴۰۵\/۰۷\/۲۰/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("supports the public contract without exposing a total-inventory denominator", () => {
    render(<RoomPricingCalendar rooms={[{
      id: 7, name: "اتاق تست", days: [{ ...days[0], totalInventory: undefined }],
    }]} startOffset={0} />);

    expect(screen.getByText("۲")).toBeTruthy();
    expect(screen.queryByText("۲/۳")).toBeNull();
  });

  it("can use a single-column read-only layout without changing management defaults", () => {
    const view = render(<RoomPricingCalendar layout="single" rooms={[{
      id: 7, name: "اتاق تست", days: [{ ...days[0], availabilityLabel: "۲ واحد" }],
    }]} startOffset={0} />);
    expect(screen.getByText("۲ واحد")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
    expect(view.container.querySelector(".md\\:grid-cols-2")).toBeNull();
  });

  it("keeps compact guest cells and icon removal scoped to the guest variant", () => {
    const guestDay = { ...days[0], availabilityLabel: "", isPast: true };
    const view = render(<RoomPricingCalendar audience="guest" rooms={[{
      id: 7, name: "اتاق تست", days: [guestDay, { ...days[1], availabilityLabel: "درخواست رزرو" }, { ...days[2], availabilityLabel: "ناموجود" }],
    }]} startOffset={1} />);
    const guest = screen.getByRole("group", { name: /۱۴۰۵\/۰۷\/۱۸/ });
    const dayNumber = within(guest).getByText("۱۸");
    const price = within(guest).getByText("۳٬۰۰۰");
    expect(guest.className).toContain("min-h-14");
    expect(guest.className).toContain("text-center");
    expect(dayNumber.className).toContain("text-base");
    expect(price.className).toContain("text-[11px]");
    expect(dayNumber.parentElement).toBe(price.parentElement);
    expect(dayNumber.compareDocumentPosition(price) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const missingPriceDay = screen.getByRole("group", { name: /۱۴۰۵\/۰۷\/۱۹/ });
    expect(within(missingPriceDay).getByText("—").previousElementSibling?.textContent).toBe("۱۹");
    expect(guest.parentElement?.className).toContain("grid-cols-7");
    expect(screen.queryByText("موجود")).toBeNull();
    expect(screen.getByText("درخواست رزرو")).toBeTruthy();
    expect(screen.getByText("ناموجود")).toBeTruthy();
    expect(guest.getAttribute("aria-label")).toContain("نرخ ۳٬۰۰۰٬۰۰۰ تومان");
    expect(guest.getAttribute("aria-label")).not.toContain("موجود");
    expect(screen.queryByRole("heading", { name: "اتاق تست" })).toBeNull();
    expect(screen.queryByText("⚡")).toBeNull();
    expect(screen.queryByText("۲")).toBeNull();
    expect(dayNumber.className).toContain("text-muted-foreground");
    expect(price.className).toContain("text-muted-foreground");

    view.rerender(<RoomPricingCalendar rooms={[{ id: 7, name: "اتاق تست", days: [days[0]], onDaySelect: vi.fn() }]} startOffset={1} />);
    expect(screen.getByText("⚡")).toBeTruthy();
    expect(screen.getByText("۲/۳")).toBeTruthy();
    const operatorDay = screen.getByRole("button", { name: /۱۴۰۵\/۰۷\/۱۸/ });
    expect(screen.getByRole("heading", { name: "اتاق تست" })).toBeTruthy();
    expect(operatorDay.className).toContain("text-right");
    expect(within(operatorDay).getByText("۱۸").className).toContain("text-[11px]");
    expect(within(operatorDay).getByText("۳٬۰۰۰").className).toContain("text-[11px]");
  });
});
