"use client";

import { ReactNode, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";

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

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "textarea:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

let openDialogCount = 0;
let originalBodyOverflow = "";

function lockBodyScroll() {
  if (openDialogCount === 0) {
    originalBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
  }

  openDialogCount += 1;
}

function unlockBodyScroll() {
  openDialogCount = Math.max(0, openDialogCount - 1);

  if (openDialogCount === 0) {
    document.body.style.overflow = originalBodyOverflow;
  }
}

export type KoochDialogProps = {
  bodyClassName?: string;
  className?: string;
  children: ReactNode;
  closeDisabled?: boolean;
  contentClassName?: string;
  description?: ReactNode;
  dir?: "ltr" | "rtl";
  footer?: ReactNode;
  footerClassName?: string;
  initialFocusRef?: React.RefObject<HTMLElement | null>;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  size?: KoochDialogSize;
  title?: ReactNode;
};

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
  initialFocusRef,
  onOpenChange,
  open,
  size = "lg",
  title,
}: KoochDialogProps) {
  const titleId = useId();
  const descriptionId = useId();

  const dialogRef = useRef<HTMLElement>(null);
  const previouslyFocusedElementRef = useRef<HTMLElement | null>(null);

  const [isClient, setIsClient] = useState(false);
  const [isMounted, setIsMounted] = useState(open);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    setIsClient(true);
  }, []);

  useEffect(() => {
    if (open) {
      setIsMounted(true);

      const frame = window.requestAnimationFrame(() => {
        setIsVisible(true);
      });

      return () => window.cancelAnimationFrame(frame);
    }

    setIsVisible(false);

    const timeout = window.setTimeout(() => {
      setIsMounted(false);
    }, DIALOG_ANIMATION_MS);

    return () => window.clearTimeout(timeout);
  }, [open]);

  useEffect(() => {
    if (!open || !isClient) return;

    previouslyFocusedElementRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;

    lockBodyScroll();

    const focusFrame = window.requestAnimationFrame(() => {
      const preferredTarget = initialFocusRef?.current;

      if (preferredTarget) {
        preferredTarget.focus();
        return;
      }

      const dialog = dialogRef.current;
      const firstFocusable =
        dialog?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);

      (firstFocusable ?? dialog)?.focus();
    });

    return () => {
      window.cancelAnimationFrame(focusFrame);
      unlockBodyScroll();

      window.requestAnimationFrame(() => {
        previouslyFocusedElementRef.current?.focus();
      });
    };
  }, [initialFocusRef, isClient, open]);

  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (!closeDisabled) {
          event.preventDefault();
          onOpenChange(false);
        }

        return;
      }

      if (event.key !== "Tab") return;

      const dialog = dialogRef.current;
      if (!dialog) return;

      const focusableElements = Array.from(
        dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
      ).filter(
        (element) =>
          !element.hasAttribute("disabled") &&
          element.getAttribute("aria-hidden") !== "true" &&
          element.offsetParent !== null,
      );

      if (focusableElements.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }

      const firstElement = focusableElements[0];
      const lastElement = focusableElements[focusableElements.length - 1];
      const activeElement = document.activeElement;

      if (event.shiftKey && activeElement === firstElement) {
        event.preventDefault();
        lastElement.focus();
        return;
      }

      if (!event.shiftKey && activeElement === lastElement) {
        event.preventDefault();
        firstElement.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);

    return () => {
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [closeDisabled, onOpenChange, open]);

  if (!isClient || !isMounted) return null;

  const dialog = (
    <div
      aria-hidden={!isVisible}
      className={joinClasses(
        "fixed inset-0 z-[70] grid place-items-center p-4",
        "transition-opacity duration-200 ease-out motion-reduce:duration-100",
        isVisible ? "opacity-100" : "pointer-events-none opacity-0",
      )}
      dir={dir}
      data-slot="dialog-root"
    >
      <button
        aria-label="بستن دیالوگ"
        className={joinClasses(
          "fixed inset-0 z-0 bg-black/50",
          "transition-opacity duration-200 ease-out motion-reduce:duration-100",
          isVisible ? "opacity-100" : "opacity-0",
        )}
        disabled={closeDisabled}
        onClick={() => {
          if (!closeDisabled) {
            onOpenChange(false);
          }
        }}
        tabIndex={-1}
        type="button"
      />

      <section
        ref={dialogRef}
        aria-describedby={description ? descriptionId : undefined}
        aria-labelledby={title ? titleId : undefined}
        aria-modal="true"
        className={joinClasses(
          "relative z-10 grid h-[min(760px,90vh)] w-[calc(100vw-2rem)] grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden rounded-lg border border-border bg-card p-0 text-card-foreground shadow-xl",
          "transition-[opacity,transform] duration-200 ease-out motion-reduce:transform-none motion-reduce:transition-opacity motion-reduce:duration-100",
          "focus:outline-none",
          isVisible
            ? "translate-y-0 scale-100 opacity-100"
            : "translate-y-3 scale-[0.98] opacity-0",
          sizeClass[size],
          contentClassName,
          className,
        )}
        data-slot="dialog-content"
        role="dialog"
        tabIndex={-1}
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
            aria-label="بستن"
            className="touch-target-44 absolute right-4 top-2.5 grid h-6 w-6 place-items-center rounded-sm text-lg leading-none text-muted-foreground opacity-70 ring-offset-card transition hover:bg-muted hover:text-foreground hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring  disabled:pointer-events-none disabled:opacity-40"
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

  return createPortal(dialog, document.body);
}

export const KoochModal = KoochDialog;
