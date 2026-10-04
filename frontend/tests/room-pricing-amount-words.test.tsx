import { useState } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CalendarSelectionEditor } from "@/components/CalendarRangeGridEditor";
import { PricingBulkEditDialog } from "@/components/pricing/PricingBulkEditDialog";

function CalendarPriceHarness({ onSave = vi.fn() }: { onSave?: () => void }) {
  const [price, setPrice] = useState(Number.NaN);
  return <CalendarSelectionEditor
    mode="pricing"
    selectedCount={1}
    selectedDayCount={1}
    selectionRangeCount={1}
    open
    onOpenChange={vi.fn()}
    onCancel={vi.fn()}
    onSave={onSave}
    onPriceValueChange={setPrice}
    priceValue={price}
    pricingCurrencyLabel="ریال"
  />;
}

describe("Room Pricing amount in words", () => {
  it("updates the calendar price description and leaves save's numeric value unchanged", () => {
    const onSave = vi.fn();
    render(<CalendarPriceHarness onSave={onSave} />);
    const input = screen.getByRole("textbox", { name: "نرخ اتاق" });
    expect(screen.queryByText("یک میلیون ریال")).toBeNull();

    fireEvent.change(input, { target: { value: "1000000" } });
    const description = screen.getByText("یک میلیون ریال");
    expect(input.getAttribute("aria-describedby")).toBe(description.id);
    expect((input as HTMLInputElement).value).toBe("۱٬۰۰۰٬۰۰۰");

    fireEvent.change(input, { target: { value: "-" } });
    expect(screen.queryByText("یک میلیون ریال")).toBeNull();
    expect(input.getAttribute("aria-describedby")).toBeNull();
    fireEvent.change(input, { target: { value: "10" } });
    expect(screen.getByText("ده ریال")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "ذخیره" }));
    expect(onSave).toHaveBeenCalledOnce();
  });

  it("updates each bulk room input without changing the submitted numeric payload", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<PricingBulkEditDialog
      open
      rooms={[{ id: 1, label: "زنبق", basePrice: 1_000_000 }]}
      initialSelectedRoomIds={[1]}
      initialStartDate="2099-01-01"
      initialEndDate="2099-01-03"
      onOpenChange={vi.fn()}
      onSubmit={onSubmit}
      pricingCurrencyLabel="ریال"
      renderDateRangeFields={() => <div />}
    />);
    const dialog = await screen.findByRole("dialog");
    const input = within(dialog).getByRole("textbox", { name: "اتاق زنبق" });

    fireEvent.change(input, { target: { value: "abc" } });
    expect(within(dialog).queryByText("یک میلیون ریال")).toBeNull();
    fireEvent.click(within(dialog).getByRole("button", { name: "ذخیره" }));
    expect(onSubmit).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: "۱٬۰۰۰٬۰۰۰" } });
    const description = within(dialog).getByText("یک میلیون ریال");
    expect(input.getAttribute("aria-describedby")).toBe(description.id);
    fireEvent.click(within(dialog).getByRole("button", { name: "ذخیره" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      roomPrices: [{ roomId: 1, roomLabel: "زنبق", basePrice: 1_000_000 }],
    })));
  });

  it("updates the bulk all-rooms field and its room fields together", async () => {
    render(<PricingBulkEditDialog
      open
      rooms={[{ id: 1, label: "زنبق", basePrice: 1_000_000 }, { id: 2, label: "لاله", basePrice: 1_000_000 }]}
      initialSelectedRoomIds={[1, 2]}
      onOpenChange={vi.fn()}
      onSubmit={vi.fn()}
      pricingCurrencyLabel="ریال"
      renderDateRangeFields={() => <div />}
    />);
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByRole("textbox", { name: "قیمت همه اتاق‌ها" }), {
      target: { value: "1000000" },
    });
    expect(within(dialog).getAllByText("یک میلیون ریال")).toHaveLength(3);
  });
});
