import { createRef } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { KoochButton, KoochButtonAppearanceProvider } from "@/components/KoochButton";
import { KoochDialog } from "@/components/KoochDialog";

describe("Admin button appearance", () => {
  it.each(["dashboard-light", "dashboard-dark"] as const)("shares the explicit charcoal treatment with the utility alias in %s", (appearance) => {
    render(<KoochButtonAppearanceProvider value={appearance}>
      <KoochButton variant="charcoal">سوابق</KoochButton>
      <KoochButton variant="utility">ابزار</KoochButton>
      <KoochButton>ذخیره</KoochButton>
    </KoochButtonAppearanceProvider>);
    const charcoal = screen.getByRole("button", { name: "سوابق" });
    expect(charcoal.className).toBe(screen.getByRole("button", { name: "ابزار" }).className);
    expect(charcoal.className).toContain("kooch-admin-button-utility");
    expect(charcoal.getAttribute("data-kooch-button-theme")).toBe(appearance.endsWith("dark") ? "dark" : "light");
    expect(screen.getByRole("button", { name: "ذخیره" }).className).toContain("kooch-admin-button-primary");
  });
  it("keeps existing default variants and sizes outside the Admin scope", () => {
    render(<>
      <KoochButton>اصلی</KoochButton>
      <KoochButton variant="outline" size="sm">فرعی</KoochButton>
      <KoochButton variant="utility">ابزار</KoochButton>
    </>);
    screen.getAllByRole("button").forEach((button) => {
      expect(button.hasAttribute("data-kooch-button-theme")).toBe(false);
      expect(button.className).not.toContain("kooch-admin-button");
      expect(button.className).toContain("rounded-md");
    });
    expect(screen.getByRole("button", { name: "اصلی" }).className).toContain("bg-primary");
    expect(screen.getByRole("button", { name: "فرعی" }).className).toContain("min-h-9");
    expect(screen.getByRole("button", { name: "ابزار" }).className).toContain("bg-background");
  });

  it("scopes primary, utility and outline treatments without changing siblings", () => {
    render(<>
      <KoochButton>خارج از پنل</KoochButton>
      <KoochButtonAppearanceProvider value="admin-light">
        <KoochButton>ذخیره</KoochButton>
        <KoochButton variant="utility" size="sm">جستجو</KoochButton>
        <KoochButton variant="outline">انصراف</KoochButton>
      </KoochButtonAppearanceProvider>
    </>);
    ["ذخیره", "جستجو", "انصراف"].forEach((name) => {
      const button = screen.getByRole("button", { name });
      expect(button.getAttribute("data-kooch-button-theme")).toBe("light");
      expect(button.className).toContain("rounded-lg");
      expect(button.className).toContain("focus-visible:ring-2");
      expect(button.className).toContain("motion-reduce:transition-none");
    });
    expect(screen.getByRole("button", { name: "جستجو" }).className).toContain("kooch-admin-button-utility");
    expect(screen.getByRole("button", { name: "جستجو" }).className).toContain("min-h-9");
    expect(screen.getByRole("button", { name: "انصراف" }).className).not.toContain("kooch-admin-button-filled");
    expect(screen.getByRole("button", { name: "خارج از پنل" }).hasAttribute("data-kooch-button-theme")).toBe(false);
  });

  it("leaves destructive, ghost, icon and segmented controls on their existing styles", () => {
    render(<KoochButtonAppearanceProvider value="admin-dark">
      <KoochButton variant="destructive">حذف</KoochButton>
      <KoochButton variant="ghost">بستن</KoochButton>
      <KoochButton size="icon" aria-label="پاک کردن" />
      <KoochButton aria-pressed={true}>انتخاب‌شده</KoochButton>
      <KoochButton aria-pressed={false} variant="outline">انتخاب‌نشده</KoochButton>
      <KoochButton role="tab" aria-selected={true}>زبانه</KoochButton>
    </KoochButtonAppearanceProvider>);
    [...screen.getAllByRole("button"), screen.getByRole("tab")].forEach((button) => {
      expect(button.className).not.toContain("kooch-admin-button");
      expect(button.hasAttribute("data-kooch-button-theme")).toBe(false);
    });
    expect(screen.getByRole("button", { name: "حذف" }).className).toContain("bg-destructive");
    expect(screen.getByRole("button", { name: "پاک کردن" }).className).toContain("h-10 w-10");
    expect(screen.getByRole("button", { name: "انتخاب‌شده" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("retains form attributes, forwarded refs, icon spacing and click behavior", () => {
    const onClick = vi.fn();
    const ref = createRef<HTMLButtonElement>();
    render(<KoochButtonAppearanceProvider value="admin-light">
      <KoochButton ref={ref} type="submit" form="edit-form" onClick={onClick}
        leftIcon={<span aria-hidden="true" data-testid="action-icon" />}>ثبت</KoochButton>
    </KoochButtonAppearanceProvider>);
    const button = screen.getByRole("button", { name: "ثبت" });
    expect(ref.current).toBe(button);
    expect(button.getAttribute("form")).toBe("edit-form");
    expect(button.getAttribute("type")).toBe("submit");
    expect(button.className).toContain("gap-2");
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("preserves disabled/loading behavior and restores the action after loading", () => {
    const onClick = vi.fn();
    const view = render(<KoochButtonAppearanceProvider value="admin-dark">
      <KoochButton loading onClick={onClick} leftIcon={<span data-testid="action-icon" />}>ذخیره</KoochButton>
    </KoochButtonAppearanceProvider>);
    const button = screen.getByRole("button", { name: "ذخیره" });
    expect(button.hasAttribute("disabled")).toBe(true);
    expect(button.querySelector(".animate-spin")).toBeTruthy();
    expect(screen.queryByTestId("action-icon")).toBeNull();
    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
    view.rerender(<KoochButtonAppearanceProvider value="admin-dark">
      <KoochButton onClick={onClick} leftIcon={<span data-testid="action-icon" />}>ذخیره</KoochButton>
    </KoochButtonAppearanceProvider>);
    expect(button.hasAttribute("disabled")).toBe(false);
    expect(screen.getByTestId("action-icon")).toBeTruthy();
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["admin-light", "admin-dark"],
    ["dashboard-light", "dashboard-dark"],
  ] as const)("keeps %s scope and theme through a real dialog portal", async (light, dark) => {
    const onOpenChange = vi.fn();
    const content = <KoochDialog open onOpenChange={onOpenChange} title="ویرایش" footer={<>
      <KoochButton>ذخیره</KoochButton>
      <KoochButton variant="charcoal">سوابق</KoochButton>
    </>}>
      <p>محتوای فرم</p>
    </KoochDialog>;
    const view = render(<KoochButtonAppearanceProvider value={light}>{content}</KoochButtonAppearanceProvider>);
    const dialog = await screen.findByRole("dialog", { name: "ویرایش" });
    const button = within(dialog).getByRole("button", { name: "ذخیره" });
    const charcoal = within(dialog).getByRole("button", { name: "سوابق" });
    expect(view.container.contains(button)).toBe(false);
    expect(button.getAttribute("data-kooch-button-theme")).toBe("light");
    expect(charcoal.getAttribute("data-kooch-button-theme")).toBe("light");
    expect(charcoal.className).toContain("kooch-admin-button-utility");
    expect(within(dialog).getByRole("button", { name: "بستن" }).hasAttribute("data-kooch-button-theme")).toBe(false);
    view.rerender(<KoochButtonAppearanceProvider value={dark}>{content}</KoochButtonAppearanceProvider>);
    expect(button.getAttribute("data-kooch-button-theme")).toBe("dark");
    expect(charcoal.getAttribute("data-kooch-button-theme")).toBe("dark");
  });
});
