"use client";

import { useId, useState, type ReactNode } from "react";
import { KoochButton } from "@/components/KoochButton";
import { KoochDialog } from "@/components/KoochDialog";
import { KoochSvgIcon } from "@/components/KoochSvgIcon";

export type KoochTableFilterDialogProps = {
  children: ReactNode;
  triggerLabel: string;
  title?: string;
  activeCount?: number;
  disabled?: boolean;
  onOpenChange?: (open: boolean) => void;
  onApply: () => void;
  onReset: () => void;
};

export function KoochTableFilterDialog({
  children,
  triggerLabel,
  title = "فیلتر و مرتب‌سازی",
  activeCount = 0,
  disabled = false,
  onOpenChange,
  onApply,
  onReset,
}: KoochTableFilterDialogProps) {
  const [open, setOpen] = useState(false);
  const formId = useId();
  const count = activeCount.toLocaleString("fa-IR");

  function changeOpen(next: boolean) {
    setOpen(next);
    onOpenChange?.(next);
  }

  return <>
    <KoochButton size="sm" variant="outline" disabled={disabled}
      aria-label={activeCount > 0 ? `${triggerLabel}، ${count} فیلتر یا مرتب‌سازی فعال` : triggerLabel}
      aria-haspopup="dialog" aria-expanded={open} title={triggerLabel}
      className={activeCount > 0 ? "border-primary bg-[var(--theme-primary-soft)] text-primary" : ""}
      onClick={() => changeOpen(true)}>
      <KoochSvgIcon src="/svgs/square-sliders.svg" size="md" />
      {activeCount > 0 && <span aria-hidden="true" className="rounded bg-primary px-1.5 py-0.5 text-xs tabular-nums text-primary-foreground">{count}</span>}
    </KoochButton>
    <KoochDialog open={open} onOpenChange={changeOpen} title={title} size="sm"
      footer={<>
        <KoochButton type="submit" form={formId} disabled={disabled}>اعمال</KoochButton>
        <KoochButton variant="outline" onClick={() => changeOpen(false)}>انصراف</KoochButton>
        <KoochButton variant="ghost" disabled={disabled} onClick={onReset}>پاک کردن</KoochButton>
      </>}>
      <form id={formId} className="grid gap-3" onSubmit={event => {
        event.preventDefault();
        if (disabled) return;
        onApply();
        changeOpen(false);
      }}>
        {children}
      </form>
    </KoochDialog>
  </>;
}
