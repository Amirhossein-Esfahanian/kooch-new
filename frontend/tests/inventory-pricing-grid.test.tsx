import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CalendarRangeGridEditor } from "@/components/CalendarRangeGridEditor";
import { KoochConfirmDialog } from "@/components/KoochConfirmDialog";

const root = resolve(import.meta.dirname, "..");

function source(path: string) {
  return readFileSync(resolve(root, path), "utf8");
}

beforeEach(() => {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn().mockImplementation(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  });
});

function renderInventoryEditor(onApplyRange = vi.fn()) {
  render(
    <CalendarRangeGridEditor
      days={[
        {
          date: "2026-08-24",
          label: "۲",
          weekday: "دوشنبه",
        },
      ]}
      getCellValue={() => ({
        availabilityId: 1,
        availableCount: 1,
        status: "Available" as const,
      })}
      maxValueResolver={(row) => row.totalInventory ?? 0}
      minValueResolver={() => 0}
      mode="inventory"
      onApplyRange={onApplyRange}
      renderCell={() => <span>سلول ظرفیت</span>}
      rows={[{ id: 4, label: "زنبق", totalInventory: 10 }]}
      statusOptions={[
        { value: "Available", label: "موجود" },
        { value: "Unavailable", label: "ناموجود" },
        { value: "OnRequest", label: "نیازمند استعلام" },
      ]}
      valueInputType="number"
      valueLabel="ظرفیت"
    />,
  );

  fireEvent.click(screen.getByText("سلول ظرفیت"));
  fireEvent.click(
    screen.getByRole("button", { name: "بازکردن پنل ویرایش" }),
  );

  return {
    input: screen.getByLabelText("ظرفیت") as HTMLInputElement,
    onApplyRange,
  };
}

describe("multi-inventory availability and pricing grids", () => {
  it("edits capacity across a date range using each RoomType TotalInventory", () => {
    const inventory = source("components/owner/OwnerInventoryGrid.tsx");
    const editor = source("components/CalendarRangeGridEditor.tsx");

    expect(inventory).toContain("label: roomType.name");
    expect(inventory).toContain(
      "maxValueResolver={(row) => row.totalInventory ?? 0}",
    );
    expect(inventory).toContain('minValueResolver={() => 0}');
    expect(inventory).toContain("/inventory/bulk-cells");
    expect(inventory).not.toContain("max === 1");
    expect(editor).toContain("maxValueResolver?.(activeRow as Row)");
    expect(editor).not.toContain("totalInventory ?? max) === 1");
  });

  it("keeps multi-unit inventory values through status selection, blur, and save", async () => {
    const { input, onApplyRange } = renderInventoryEditor();

    fireEvent.change(input, { target: { value: "2" } });
    expect(input.value).toBe("۲");

    fireEvent.change(input, { target: { value: "5" } });
    expect(input.value).toBe("۵");

    fireEvent.change(input, { target: { value: "10" } });
    fireEvent.blur(input);
    expect(input.value).toBe("۱۰");

    fireEvent.click(screen.getByRole("button", { name: "موجود" }));
    expect(input.value).toBe("۱۰");

    fireEvent.click(screen.getByRole("button", { name: "ذخیره" }));

    await waitFor(() =>
      expect(onApplyRange).toHaveBeenCalledWith(
        expect.objectContaining({
          status: "Available",
          value: 10,
        }),
      ),
    );
  });

  it("retains TotalInventory validation without deriving a cap from physical rooms", () => {
    const { input, onApplyRange } = renderInventoryEditor();

    fireEvent.change(input, { target: { value: "11" } });
    fireEvent.click(screen.getByRole("button", { name: "ذخیره" }));

    expect(onApplyRange).not.toHaveBeenCalled();
    expect(
      screen.queryByText("ظرفیت وارد شده برای برخی اتاق‌ها معتبر نیست"),
    ).not.toBeNull();
  });

  it("uses persisted RoomType names and Persian calendar/number formatting", () => {
    const inventory = source("components/owner/OwnerInventoryGrid.tsx");
    const pricing = source("components/owner/OwnerPricingGrid.tsx");
    const matrix = source("components/pricing/RoomPricingMatrixEditor.tsx");

    expect(inventory).toContain("label: roomType.name");
    expect(pricing).toContain("label: roomType.name");
    expect(inventory).toContain('new Intl.NumberFormat("fa-IR"');
    expect(pricing).toContain('new Intl.NumberFormat("fa-IR"');
    expect(pricing).toContain('.calendar("jalali")');
    expect(matrix).toContain('new Intl.NumberFormat("fa-IR"');
  });

  it("keeps confirmation dialogs above the pricing dialog layer", async () => {
    render(
      <KoochConfirmDialog
        onConfirm={vi.fn()}
        onOpenChange={vi.fn()}
        open
        title="تأیید قیمت"
      />,
    );

    const dialog = await screen.findByRole("alertdialog");
    const overlay = document.querySelector<HTMLButtonElement>(
      "button.fixed.inset-0",
    );
    const pricingDialog = source("components/pricing/PricingBulkEditDialog.tsx");

    expect(dialog.className).toContain("z-[111]");
    expect(overlay?.className).toContain("z-[110]");
    expect(pricingDialog).toContain("z-[100]");
  });
});
