import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { KoochConfirmDialog } from "@/components/KoochConfirmDialog";

const root = resolve(import.meta.dirname, "..");

function source(path: string) {
  return readFileSync(resolve(root, path), "utf8");
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
