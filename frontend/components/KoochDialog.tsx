"use client";

import { ReactNode, useEffect, useId, useState } from "react";

type KoochDialogSize = "md" | "lg" | "xl";

const sizeClass: Record<KoochDialogSize, string> = {
  md: "max-w-3xl",
  lg: "max-w-4xl",
  xl: "max-w-6xl",
};

function joinClasses(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

const DIALOG_ANIMATION_MS = 220;

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

  const [isMounted, setIsMounted] = useState(open);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    if (open) {
      setIsMounted(true);

      const frame = requestAnimationFrame(() => {
        setIsVisible(true);
      });

      return () => cancelAnimationFrame(frame);
    }

    setIsVisible(false);

    const timeout = window.setTimeout(() => {
      setIsMounted(false);
    }, DIALOG_ANIMATION_MS);

    return () => window.clearTimeout(timeout);
  }, [open]);

  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !closeDisabled) {
        onOpenChange(false);
      }
    };

    document.addEventListener("keydown", onKeyDown);

    return () => {
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [closeDisabled, onOpenChange, open]);

  if (!isMounted) return null;

  return (
    <div
      aria-describedby={description ? descriptionId : undefined}
      aria-hidden={!isVisible}
      aria-labelledby={title ? titleId : undefined}
      aria-modal="true"
      className={joinClasses(
        "fixed inset-0 z-[70] grid place-items-center p-4",
        "transition-opacity duration-200 ease-out",
        isVisible ? "opacity-100" : "pointer-events-none opacity-0",
      )}
      dir={dir}
      role="dialog"
    >
      <button
        aria-label="Close dialog"
        className={joinClasses(
          "fixed inset-0 z-0 bg-black/50",
          "transition-opacity duration-200 ease-out",
          isVisible ? "opacity-100" : "opacity-0",
        )}
        disabled={closeDisabled}
        onClick={() => onOpenChange(false)}
        type="button"
      />

      <section
        className={joinClasses(
          "relative z-10 grid h-[min(760px,90vh)] w-[calc(100vw-2rem)] grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden rounded-lg border border-border bg-card p-0 text-card-foreground shadow-xl",
          "transition-[opacity,transform] duration-200 ease-out",
          isVisible
            ? "translate-y-0 scale-100 opacity-100"
            : "translate-y-3 scale-[0.98] opacity-0",
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
            ×
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
              "sticky bottom-0 z-10 flex flex-col-reverse gap-2 border-t border-border bg-muted px-6 py-4 sm:flex-row sm:justify-start",
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
