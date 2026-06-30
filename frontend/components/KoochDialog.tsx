"use client";

import { ReactNode, useEffect, useId } from "react";

type KoochDialogSize = "md" | "lg" | "xl";

const sizeClass: Record<KoochDialogSize, string> = {
  md: "max-w-3xl",
  lg: "max-w-4xl",
  xl: "max-w-6xl",
};

function joinClasses(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

export function KoochDialog({
  bodyClassName = "",
  className = "",
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
  className?: string;
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
  title?: ReactNode;
}) {
  const titleId = useId();
  const descriptionId = useId();

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
      aria-describedby={description ? descriptionId : undefined}
      aria-labelledby={title ? titleId : undefined}
      aria-modal="true"
      className="fixed inset-0 z-[70] grid place-items-center p-4"
      dir={dir}
      role="dialog"
    >
      <button
        aria-label="Close dialog"
        className="fixed inset-0 z-0 bg-black/50"
        disabled={closeDisabled}
        onClick={() => onOpenChange(false)}
        type="button"
      />
      <section
        className={joinClasses(
          "relative z-10 grid h-[min(760px,90vh)] w-[calc(100vw-2rem)] grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden rounded-lg border border-border bg-card p-0 text-card-foreground shadow-xl",
          sizeClass[size],
          contentClassName,
          className,
        )}
        data-slot="dialog-content"
      >
        <header
          className="sticky top-0 z-10 grid gap-1.5 border-b border-border bg-card px-6 py-5 text-right"
          data-slot="dialog-header"
        >
          <div className="max-w-[calc(100%-2.5rem)]">
            {title && (
              <h2
                className="text-lg font-semibold leading-none tracking-tight text-card-foreground"
                data-slot="dialog-title"
                id={titleId}
              >
                {title}
              </h2>
            )}
            {description && (
              <p
                className="mt-2 text-sm leading-6 text-muted-foreground"
                data-slot="dialog-description"
                id={descriptionId}
              >
                {description}
              </p>
            )}
          </div>
          <button
            aria-label="Close"
            className="absolute left-4 top-4 grid h-8 w-8 place-items-center rounded-sm text-lg leading-none text-muted-foreground opacity-70 ring-offset-card transition hover:bg-muted hover:text-foreground hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none disabled:opacity-40"
            disabled={closeDisabled}
            onClick={() => onOpenChange(false)}
            type="button"
          >
            x
          </button>
        </header>

        <div
          className={joinClasses(
            "min-h-0 overflow-y-auto bg-card px-6 py-5",
            bodyClassName,
          )}
          data-slot="dialog-body"
        >
          {children}
        </div>

        {footer && (
          <footer
            className={joinClasses(
              "sticky bottom-0 z-10 flex flex-col-reverse gap-2 border-t border-border bg-card px-6 py-4 shadow-[0_-10px_20px_rgb(15_23_42/0.06)] sm:flex-row sm:justify-start dark:shadow-[0_-10px_20px_rgb(0_0_0/0.28)]",
              footerClassName,
            )}
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
      ? "inline-flex min-h-10 items-center justify-center rounded-md border border-primary bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition hover:bg-[var(--primary-hover)] disabled:opacity-60"
      : variant === "danger"
        ? "inline-flex min-h-10 items-center justify-center rounded-md border border-destructive bg-destructive px-4 py-2 text-sm font-semibold text-destructive-foreground transition hover:bg-[var(--theme-danger)] disabled:opacity-60"
        : "inline-flex min-h-10 items-center justify-center rounded-md border border-border bg-background px-4 py-2 text-sm font-medium text-foreground transition hover:bg-muted disabled:opacity-60";

  return (
    <button
      className={className}
      disabled={disabled}
      form={form}
      onClick={onClick}
      type={type}
    >
      {children}
    </button>
  );
}
