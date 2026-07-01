"use client";

import {
  cloneElement,
  isValidElement,
  ReactElement,
  ReactNode,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { KoochButton } from "@/components/KoochButton";

export type KoochConfirmDialogVariant =
  | "default"
  | "warning"
  | "destructive"
  | "success";

export type KoochConfirmDialogProps = {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  trigger?: ReactNode;
  title: string;
  description?: ReactNode;
  children?: ReactNode;
  confirmText?: string;
  cancelText?: string;
  variant?: KoochConfirmDialogVariant;
  loading?: boolean;
  disabled?: boolean;
  className?: string;
  onConfirm: () => void | Promise<void>;
};

function joinClasses(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

const variantTone: Record<
  KoochConfirmDialogVariant,
  { confirmClassName: string; icon: string; iconClassName: string; titleClassName: string }
> = {
  default: {
    confirmClassName: "",
    icon: "/svgs/info.svg",
    iconClassName: "bg-primary",
    titleClassName: "text-foreground",
  },
  warning: {
    confirmClassName:
      "border-amber-500 bg-amber-500 text-white hover:bg-amber-600",
    icon: "/svgs/alert.svg",
    iconClassName: "bg-amber-500",
    titleClassName: "text-amber-700 dark:text-amber-300",
  },
  destructive: {
    confirmClassName: "",
    icon: "/svgs/error.svg",
    iconClassName: "bg-destructive",
    titleClassName: "text-destructive",
  },
  success: {
    confirmClassName:
      "border-emerald-600 bg-emerald-600 text-white hover:bg-emerald-700",
    icon: "/svgs/success.svg",
    iconClassName: "bg-emerald-600",
    titleClassName: "text-emerald-700 dark:text-emerald-300",
  },
};

type TriggerElementProps = {
  onClick?: (event: React.MouseEvent) => void;
};

export function KoochConfirmDialog({
  cancelText = "انصراف",
  children,
  className = "",
  confirmText = "تایید",
  description,
  disabled = false,
  loading = false,
  onConfirm,
  onOpenChange,
  open,
  title,
  trigger,
  variant = "default",
}: KoochConfirmDialogProps) {
  const titleId = useId();
  const descriptionId = useId();
  const [mounted, setMounted] = useState(false);
  const [internalOpen, setInternalOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const cancelButtonRef = useRef<HTMLButtonElement | null>(null);
  const lastFocusedRef = useRef<HTMLElement | null>(null);

  const isControlled = open !== undefined && onOpenChange !== undefined;
  const isOpen = isControlled ? Boolean(open) : internalOpen;
  const isBusy = loading || submitting;
  const actionDisabled = disabled || isBusy;
  const tone = variantTone[variant];

  function setDialogOpen(nextOpen: boolean) {
    if (nextOpen) {
      lastFocusedRef.current =
        typeof document !== "undefined"
          ? (document.activeElement as HTMLElement | null)
          : null;
    }
    if (isControlled) {
      onOpenChange?.(nextOpen);
    } else {
      setInternalOpen(nextOpen);
    }
  }

  function closeDialog() {
    setDialogOpen(false);
  }

  async function handleConfirm() {
    if (actionDisabled) return;
    setSubmitting(true);
    try {
      await onConfirm();
      closeDialog();
    } catch (error) {
      console.error(error);
    } finally {
      setSubmitting(false);
    }
  }

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!isOpen) return;

    const focusTimer = window.setTimeout(() => {
      cancelButtonRef.current?.focus();
    }, 0);

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        closeDialog();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [isOpen]);

  useEffect(() => {
    if (isOpen) return;
    lastFocusedRef.current?.focus?.();
  }, [isOpen]);

  const triggerNode =
    trigger && isValidElement(trigger)
      ? cloneElement(trigger as ReactElement<TriggerElementProps>, {
          onClick: (event: React.MouseEvent) => {
            (trigger as ReactElement<TriggerElementProps>).props.onClick?.(
              event,
            );
            if (!event.defaultPrevented) setDialogOpen(true);
          },
        })
      : trigger
        ? (
            <button onClick={() => setDialogOpen(true)} type="button">
              {trigger}
            </button>
          )
        : null;

  const dialog = isOpen ? (
    <>
      <button
        aria-label="بستن دیالوگ"
        className="fixed inset-0 z-[90] bg-black/50 backdrop-blur-sm"
        onClick={closeDialog}
        type="button"
      />
      <section
        aria-describedby={description ? descriptionId : undefined}
        aria-labelledby={titleId}
        aria-modal="true"
        className={joinClasses(
          "fixed left-1/2 top-1/2 z-[91] w-[calc(100%-2rem)] max-w-[440px] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border bg-card p-5 text-card-foreground shadow-2xl",
          className,
        )}
        dir="rtl"
        onClick={(event) => event.stopPropagation()}
        role="alertdialog"
      >
        <header className="flex items-start gap-3 text-right">
          <span
            aria-hidden="true"
            className={joinClasses(
              "mt-0.5 h-6 w-6 shrink-0",
              tone.iconClassName,
            )}
            style={{
              WebkitMask: `url(${tone.icon}) center / contain no-repeat`,
              mask: `url(${tone.icon}) center / contain no-repeat`,
            }}
          />
          <div className="min-w-0">
            <h2
              className={joinClasses(
                "text-base font-black leading-7",
                tone.titleClassName,
              )}
              id={titleId}
            >
              {title}
            </h2>
            {description && (
              <div
                className="mt-2 text-sm leading-7 text-muted-foreground"
                id={descriptionId}
              >
                {description}
              </div>
            )}
          </div>
        </header>

        {children && <div className="mt-4 text-sm leading-7">{children}</div>}

        <footer className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-start">
          <KoochButton
            className="w-full sm:w-auto"
            onClick={closeDialog}
            ref={cancelButtonRef}
            type="button"
            variant="outline"
          >
            {cancelText}
          </KoochButton>
          <KoochButton
            className={joinClasses("w-full sm:w-auto", tone.confirmClassName)}
            disabled={actionDisabled}
            loading={isBusy}
            onClick={handleConfirm}
            type="button"
            variant={variant === "destructive" ? "destructive" : "primary"}
          >
            {confirmText}
          </KoochButton>
        </footer>
      </section>
    </>
  ) : null;

  return (
    <>
      {triggerNode}
      {mounted && dialog ? createPortal(dialog, document.body) : null}
    </>
  );
}
