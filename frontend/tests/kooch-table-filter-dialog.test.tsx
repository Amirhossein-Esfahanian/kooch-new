import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { KoochTableFilterDialog } from "@/components/KoochTable";
import { KoochField, KoochInput } from "@/components/KoochFormControls";

function Harness({ apply = vi.fn(), reset = vi.fn() }: { apply?: (value: string) => void; reset?: () => void }) {
  const [applied, setApplied] = useState("");
  const [draft, setDraft] = useState("");
  return <>
    <output aria-label="عبارت اعمال‌شده">{applied || "بدون فیلتر"}</output>
    <KoochTableFilterDialog triggerLabel="فیلتر جدول" activeCount={applied ? 1 : 0}
      onOpenChange={open => { if (open) setDraft(applied); }}
      onApply={() => { apply(draft); setApplied(draft); }}
      onReset={() => { reset(); setDraft(""); }}>
      <KoochField label="جستجو"><KoochInput value={draft} onChange={event => setDraft(event.target.value)} /></KoochField>
    </KoochTableFilterDialog>
  </>;
}

describe("KoochTableFilterDialog", () => {
  it("opens an accessible shared dialog and commits only on Apply", async () => {
    const apply = vi.fn();
    render(<Harness apply={apply} />);
    const trigger = screen.getByRole("button", { name: "فیلتر جدول" });
    expect(trigger.getAttribute("aria-haspopup")).toBe("dialog");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(trigger);
    const dialog = await screen.findByRole("dialog", { name: "فیلتر و مرتب‌سازی" });
    expect(dialog.closest("[dir]")?.getAttribute("dir")).toBe("rtl");
    fireEvent.change(within(dialog).getByRole("textbox", { name: "جستجو" }), { target: { value: "تازه" } });
    expect(apply).not.toHaveBeenCalled();
    expect(screen.getByLabelText("عبارت اعمال‌شده").textContent).toBe("بدون فیلتر");
    fireEvent.click(within(dialog).getByRole("button", { name: "اعمال" }));
    expect(apply).toHaveBeenCalledWith("تازه");
    expect(screen.getByLabelText("عبارت اعمال‌شده").textContent).toBe("تازه");
    const active = screen.getByRole("button", { name: /فیلتر جدول، ۱/ });
    expect(active.classList.contains("text-primary")).toBe(true);
    expect(active.textContent).toBe("۱");
    expect(active.getAttribute("aria-expanded")).toBe("false");
  });

  it.each(["cancel", "escape"])("discards draft changes on %s and restores the applied value on reopen", async close => {
    const apply = vi.fn();
    render(<Harness apply={apply} />);
    fireEvent.click(screen.getByRole("button", { name: "فیلتر جدول" }));
    const dialog = await screen.findByRole("dialog", { name: "فیلتر و مرتب‌سازی" });
    fireEvent.change(within(dialog).getByRole("textbox", { name: "جستجو" }), { target: { value: "draft" } });
    if (close === "cancel") fireEvent.click(within(dialog).getByRole("button", { name: "انصراف" }));
    else fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(apply).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "فیلتر جدول" }));
    expect(within(await screen.findByRole("dialog")).getByRole<HTMLInputElement>("textbox", { name: "جستجو" }).value).toBe("");
  });

  it("resets draft controls and updates the active badge only after Apply", async () => {
    const reset = vi.fn();
    render(<Harness reset={reset} />);
    fireEvent.click(screen.getByRole("button", { name: "فیلتر جدول" }));
    let dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByRole("textbox", { name: "جستجو" }), { target: { value: "query" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "اعمال" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    fireEvent.click(screen.getByRole("button", { name: /فیلتر جدول، ۱/ }));
    dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "پاک کردن" }));
    expect(reset).toHaveBeenCalledOnce();
    expect(within(dialog).getByRole<HTMLInputElement>("textbox", { name: "جستجو" }).value).toBe("");
    expect(screen.getByLabelText("عبارت اعمال‌شده").textContent).toBe("query");
    expect(screen.getByRole("button", { name: /فیلتر جدول، ۱/ })).not.toBeNull();
    fireEvent.click(within(dialog).getByRole("button", { name: "اعمال" }));
    expect(screen.getByLabelText("عبارت اعمال‌شده").textContent).toBe("بدون فیلتر");
    expect(screen.getByRole("button", { name: "فیلتر جدول" }).textContent).toBe("");
  });
});
