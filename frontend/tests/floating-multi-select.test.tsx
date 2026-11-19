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

it.each([360, 1280])("keeps the 12px gap through first/multiple checks and the last uncheck while the dialog recenters (%ipx)", async width => {
  vi.stubGlobal("innerWidth", width);
  vi.stubGlobal("innerHeight", 900);
  let anchorTop = 400;
  vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(500);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    const isTrigger = this.id === "moving-rooms";
    const top = isTrigger ? anchorTop : Number.parseFloat(this.style.top || "0");
    const height = isTrigger ? 40 : Math.min(500, Number.parseFloat(this.style.maxHeight || "500"));
    return { top, bottom: top + height, left: 16, right: width - 16, width: width - 32, height, x: 16, y: top, toJSON() {} };
  });
  function Picker() {
    const [value, setValue] = useState<Array<string | number>>([]);
    return <KoochDialog open title="اتاق‌ها" onOpenChange={vi.fn()}>
      <KoochMultiSelect id="moving-rooms" floating showBulkActions={false} value={value} onChange={setValue}
        placeholder="انتخاب" searchPlaceholder="جستجو" options={[{ value: 1, label: "دبل" }, { value: 2, label: "سوئیت" }]} />
      {value.map(id => <p key={id} data-selected-row>{id}</p>)}
    </KoochDialog>;
  }
  render(<Picker />);
  const dialog = await screen.findByRole("dialog");
  const trigger = within(dialog).getByRole("button", { name: "انتخاب" });
  fireEvent.click(trigger);
  const search = await screen.findByRole("textbox", { name: "جستجو" });
  const panel = document.getElementById(trigger.getAttribute("aria-controls")!)!;
  const assertGap = async () => {
    await waitFor(() => expect(Number.parseFloat(panel.style.top) - (anchorTop + 40)).toBe(12));
    expect(panel.getAttribute("data-placement")).toBe("below");
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(document.activeElement).toBe(search);
  };
  search.focus();
  anchorTop = 350;
  fireEvent.click(within(panel).getByRole("button", { name: "دبل" }));
  await assertGap();
  expect(panel.compareDocumentPosition(dialog.querySelector("[data-selected-row]")!) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
  fireEvent.change(search, { target: { value: "سوئیت" } });
  anchorTop = 330;
  fireEvent.click(within(panel).getByRole("button", { name: "سوئیت" }));
  await assertGap();
  expect((search as HTMLInputElement).value).toBe("سوئیت");
  fireEvent.click(within(panel).getByRole("button", { name: "سوئیت" }));
  fireEvent.change(search, { target: { value: "" } });
  anchorTop = 400;
  fireEvent.click(within(panel).getByRole("button", { name: "دبل" }));
  await assertGap();
  expect(dialog.querySelector("[data-selected-row]")).toBeNull();
});
