import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { GuestCountControls } from "@/components/GuestCountControls";
import { GuestSelector, type GuestSelectorValue } from "@/components/GuestSelector";
import { installNativePopoverStub } from "./helpers/native-popover";

function AdminCounts() {
  const [adults, setAdults] = useState(1);
  const [ages, setAges] = useState<string[]>([]);
  return <GuestCountControls compact requireChildAges adults={adults} maxAdults={2} maxChildren={2}
    childrenCount={ages.length} childAges={ages} onAdultsChange={setAdults}
    onChildrenChange={count => setAges(current => Array.from({ length: count }, (_, index) => current[index] ?? ""))}
    onChildAgeChange={(index, age) => setAges(current => current.map((value, i) => i === index ? age : value))} />;
}

it("uses bounded non-submit counters and explicit child ages, preserving siblings on removal", () => {
  render(<AdminCounts />);
  expect((screen.getByRole("button", { name: "کاهش بزرگسال" }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "افزایش بزرگسال" }));
  expect((screen.getByRole("button", { name: "افزایش بزرگسال" }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "افزایش کودک" }));
  const first = screen.getByRole("combobox", { name: "سن کودک ۱" }) as HTMLSelectElement;
  expect(first.value).toBe(""); expect(first.required).toBe(true);
  expect(first.getAttribute("aria-invalid")).toBe("true");
  fireEvent.change(first, { target: { value: "0" } });
  expect(first.value).toBe("0"); expect(first.getAttribute("aria-invalid")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "افزایش کودک" }));
  expect((screen.getByRole("button", { name: "افزایش کودک" }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.change(screen.getByRole("combobox", { name: "سن کودک ۲" }), { target: { value: "17" } });
  fireEvent.click(screen.getByRole("button", { name: "کاهش کودک" }));
  expect(first.value).toBe("0"); expect(screen.queryByRole("combobox", { name: "سن کودک ۲" })).toBeNull();
  expect(screen.getAllByRole("button").every(button => button.getAttribute("type") === "button")).toBe(true);
});

it("retains search defaults, room count, clear bounds, Escape and focus restoration", () => {
  function SearchCounts() {
    const [value, setValue] = useState<GuestSelectorValue>({ rooms: 1, adults: 2, children: 0, childAges: [] });
    return <GuestSelector value={value} onChange={setValue} />;
  }
  render(<SearchCounts />);
  const trigger = screen.getByRole("button", { name: /^مسافران/ });
  fireEvent.click(trigger);
  fireEvent.click(screen.getByRole("button", { name: "افزایش تعداد اتاق" }));
  fireEvent.click(screen.getByRole("button", { name: "افزایش کودک" }));
  const age = screen.getByRole("combobox", { name: "سن کودک ۱" }) as HTMLSelectElement;
  expect(age.value).toBe("5"); expect(age.required).toBe(false);
  fireEvent.change(age, { target: { value: "9" } });
  expect(age.value).toBe("9");
  expect(trigger.textContent).toContain("۲ اتاق");
  fireEvent.keyDown(age, { key: "Escape" });
  expect(screen.queryByRole("combobox")).toBeNull(); expect(document.activeElement).toBe(trigger);
});

it("reuses the floating picker with bounded room totals and required blank ages outside the popover", () => {
  installNativePopoverStub();
  function ManualGuests() {
    const [value, setValue] = useState<GuestSelectorValue<string>>({ rooms: 1, adults: 1, children: 0, childAges: [] });
    return <GuestSelector value={value} onChange={setValue} floating maxRooms={2} maxAdults={2} maxChildren={2}
      childAgesOutside requireChildAges defaultChildAge="" />;
  }
  render(<ManualGuests />);
  const trigger = screen.getByRole("button", { name: /^مسافران:/ });
  fireEvent.click(trigger);
  const popup = screen.getByRole("group", { name: "انتخاب مسافران و اتاق‌ها" });
  expect(popup.className).toContain("fixed");
  expect(popup.getAttribute("popover")).toBe("manual");
  expect(popup.getAttribute("dir")).toBe("rtl");
  expect(popup.style.left).toBe("16px");
  fireEvent.click(screen.getByRole("button", { name: "افزایش تعداد اتاق" }));
  expect((screen.getByRole("button", { name: "افزایش تعداد اتاق" }) as HTMLButtonElement).disabled).toBe(true);
  expect(trigger.textContent).toContain("۲ اتاق");
  const addChild = screen.getByRole("button", { name: "افزایش کودک" });
  addChild.focus(); fireEvent.click(addChild);
  const age = screen.getByRole("combobox", { name: "سن کودک ۱" }) as HTMLSelectElement;
  expect(popup.contains(age)).toBe(false);
  expect(age.required).toBe(true); expect(age.value).toBe("");
  expect(document.activeElement).toBe(addChild);
  fireEvent.keyDown(addChild, { key: "Escape" });
  expect(screen.queryByRole("group", { name: "انتخاب مسافران و اتاق‌ها" })).toBeNull();
  expect(document.activeElement).toBe(trigger);
  expect(screen.getByRole("combobox", { name: "سن کودک ۱" })).toBe(age);
  fireEvent.change(age, { target: { value: "0" } });
  fireEvent.click(trigger);
  expect(age.value).toBe("0");
  fireEvent.pointerDown(document.body);
  expect(trigger.getAttribute("aria-expanded")).toBe("false");
});
