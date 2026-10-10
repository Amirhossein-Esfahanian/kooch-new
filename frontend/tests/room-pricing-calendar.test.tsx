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
});
