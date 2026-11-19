import { useState } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { KoochMultiSelect } from "@/components/KoochFormControls";
import { KoochDialog } from "@/components/KoochDialog";
import { installNativePopoverStub } from "./helpers/native-popover";

beforeEach(() => installNativePopoverStub());
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it.each([[360, 800, 700], [1280, 800, 700], [360, 300, 160]])("keeps a long RTL picker anchored and scrollable in the dialog focus scope (%ix%i)", async (width, height, anchorTop) => {
  vi.stubGlobal("innerWidth", width);
  vi.stubGlobal("innerHeight", height);
  vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(500);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    const top = this.id === "floating-rooms" ? anchorTop : 0;
    return { top, bottom: top + 40, left: width - 336, right: width - 16, width: 320, height: 40, x: width - 336, y: top, toJSON() {} };
  });
  const onClose = vi.fn();
  function Picker() {
    const [value, setValue] = useState<Array<string | number>>([]);
    return <KoochDialog open title="انتخاب اتاق آزمایشی" onOpenChange={onClose}>
      <KoochMultiSelect id="floating-rooms" floating showBulkActions={false} value={value} onChange={setValue}
        placeholder="اتاق‌ها" searchPlaceholder="جستجوی اتاق‌ها"
        options={Array.from({ length: 50 }, (_, index) => ({ value: index, label: `اتاق ${index}` }))} />
    </KoochDialog>;
  }
  render(<Picker />);
  const dialog = await screen.findByRole("dialog");
  const trigger = within(dialog).getByRole("button", { name: "اتاق‌ها" });
  fireEvent.click(trigger);
  const search = await screen.findByRole("textbox", { name: "جستجوی اتاق‌ها" });
  const panel = document.getElementById(trigger.getAttribute("aria-controls")!)!;
  expect(dialog.contains(panel)).toBe(true);
  expect(panel.getAttribute("popover")).toBe("manual");
  expect(panel.getAttribute("data-placement")).toBe("above");
  expect(panel.style.position).toBe("fixed");
  expect(Number.parseFloat(panel.style.left)).toBeGreaterThanOrEqual(16);
  expect(Number.parseFloat(panel.style.left) + Number.parseFloat(panel.style.width)).toBeLessThanOrEqual(width - 16);
  expect(Number.parseFloat(panel.style.top)).toBeLessThan(anchorTop);
  expect(Number.parseFloat(panel.style.maxHeight)).toBeLessThanOrEqual(height - 32);
  const option = await screen.findByRole("button", { name: "اتاق 0" });
  expect(option.parentElement?.className).toContain("overflow-y-auto");
  expect(option.parentElement?.contains(search)).toBe(false);
  expect(search.parentElement?.className).toContain("shrink-0");
  fireEvent.click(option);
  expect(trigger.getAttribute("aria-expanded")).toBe("true");
  fireEvent.change(search, { target: { value: "اتاق 49" } });
  fireEvent.click(screen.getByRole("button", { name: "اتاق 49" }));
  fireEvent.change(search, { target: { value: "" } });
  expect(screen.getByRole("button", { name: "اتاق 0" }).getAttribute("aria-pressed")).toBe("true");
  search.focus();
  fireEvent.keyDown(search, { key: "Escape" });
  await waitFor(() => expect(trigger.getAttribute("aria-expanded")).toBe("false"));
  expect(document.activeElement).toBe(trigger);
  expect(onClose).not.toHaveBeenCalled();
});
