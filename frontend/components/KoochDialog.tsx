"use client";

import { ReactNode, useEffect } from "react";

type KoochDialogSize = "md" | "lg" | "xl";

const sizeClass: Record<KoochDialogSize, string> = {
  md: "max-w-2xl",
  lg: "max-w-4xl",
  xl: "max-w-6xl",
};

export function KoochDialog({
  bodyClassName = "",
  children,
  closeDisabled = false,
  contentClassName = "",
  description,
  dir = "rtl",
  footer,
  footerClassName = "",
  onOpenChange,
  open,
  size = "lg",
  title,
}: {
  bodyClassName?: string;
  children: ReactNode;
  closeDisabled?: boolean;
  contentClassName?: string;
  description?: ReactNode;
  dir?: "ltr" | "rtl";
  footer?: ReactNode;
  footerClassName?: string;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  size?: KoochDialogSize;
  title: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !closeDisabled) onOpenChange(false);
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [closeDisabled, onOpenChange, open]);

  if (!open) return null;

  return (
    <div
      aria-modal="true"
      className="fixed inset-0 z-[70] grid place-items-center p-4"
      dir={dir}
      role="dialog"
    >
      <button
        aria-label="بستن دیالوگ"
        className="fixed inset-0 z-0 bg-black/50"
        disabled={closeDisabled}
        onClick={() => onOpenChange(false)}
        type="button"
      />
      <section
        className={`relative z-10 grid h-[min(720px,92vh)] w-full ${sizeClass[size]} grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden rounded-lg border border-[var(--theme-border)] bg-[var(--theme-surface)] p-0 text-[var(--theme-text)] shadow-lg ${contentClassName}`}
        data-slot="dialog-content"
      >
        <header
          className="sticky top-0 z-10 grid gap-1.5 border-b border-[var(--theme-border)] bg-[var(--theme-surface)] px-6 py-5 text-right"
          data-slot="dialog-header"
        >
          <div className="max-w-[calc(100%-2.5rem)]">
            <h2
              className="text-lg font-semibold leading-none tracking-tight"
              data-slot="dialog-title"
            >
              {title}
            </h2>
            {description && (
              <p
                className="mt-2 text-sm leading-6 text-[var(--theme-muted-text)]"
                data-slot="dialog-description"
              >
                {description}
              </p>
            )}
          </div>
          <button
            aria-label="بستن"
            className="absolute left-4 top-4 grid h-8 w-8 place-items-center rounded-sm text-lg leading-none text-[var(--theme-muted-text)] opacity-70 ring-offset-[var(--theme-surface)] transition hover:bg-[var(--theme-surface-muted)] hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:pointer-events-none disabled:opacity-40"
            disabled={closeDisabled}
            onClick={() => onOpenChange(false)}
            type="button"
          >
            ×
          </button>
        </header>

        <div
          className={`min-h-0 overflow-y-auto bg-[var(--theme-surface)] px-6 py-5 ${bodyClassName}`}
          data-slot="dialog-body"
        >
          {children}
        </div>

        {footer && (
          <footer
            className={`sticky bottom-0 z-10 flex flex-col-reverse gap-2 border-t border-[var(--theme-border)] bg-[var(--theme-surface)] px-6 py-4 shadow-[0_-10px_20px_rgba(15,23,42,0.06)] sm:flex-row sm:justify-start dark:shadow-[0_-10px_20px_rgba(0,0,0,0.28)] ${footerClassName}`}
            data-slot="dialog-footer"
          >
            {footer}
          </footer>
        )}
      </section>
    </div>
  );
}

export const KoochModal = KoochDialog;

export function KoochDialogButton({
  children,
  disabled,
  form,
  onClick,
  type = "button",
  variant = "secondary",
}: {
  children: ReactNode;
  disabled?: boolean;
  form?: string;
  onClick?: () => void;
  type?: "button" | "submit";
  variant?: "primary" | "secondary" | "danger";
}) {
  const className =
    variant === "primary"
      ? "inline-flex min-h-10 items-center justify-center rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:opacity-60"
      : variant === "danger"
        ? "inline-flex min-h-10 items-center justify-center rounded-md bg-red-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-700 disabled:opacity-60"
        : "inline-flex min-h-10 items-center justify-center rounded-md border border-[var(--theme-border)] bg-[var(--theme-surface)] px-4 py-2 text-sm font-medium text-[var(--theme-text)] transition hover:bg-[var(--theme-surface-muted)] disabled:opacity-60";

  return (
    <button className={className} disabled={disabled} form={form} onClick={onClick} type={type}>
      {children}
    </button>
  );
}
