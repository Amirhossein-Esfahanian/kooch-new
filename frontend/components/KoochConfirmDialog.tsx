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
  | "info"
  | "information"
  | "question"
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

type ConfirmDialogTone = {
  confirmClassName: string;
  icon: string;
  iconBackgroundClassName: string;
  iconClassName: string;
  titleClassName: string;
};

function joinClasses(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

const variantTone: Record<KoochConfirmDialogVariant, ConfirmDialogTone> = {
  default: {
    confirmClassName: "",
    icon: "/svgs/info.svg",
    iconBackgroundClassName: "bg-muted",
    iconClassName: "bg-foreground",
    titleClassName: "text-foreground",
  },
  info: {
    confirmClassName:
      "border-blue-600 bg-blue-600 text-white hover:bg-blue-700",
    icon: "/svgs/info.svg",
    iconBackgroundClassName: "bg-blue-50 dark:bg-blue-950/60",
    iconClassName: "bg-blue-600 dark:bg-blue-400",
    titleClassName: "text-foreground",
  },
  information: {
    confirmClassName:
      "border-blue-600 bg-blue-600 text-white hover:bg-blue-700",
    icon: "/svgs/info.svg",
    iconBackgroundClassName: "bg-blue-50 dark:bg-blue-950/60",
    iconClassName: "bg-blue-600 dark:bg-blue-400",
    titleClassName: "text-foreground",
  },
  question: {
    confirmClassName: "",
    icon: "/svgs/circle-question.svg",
    iconBackgroundClassName: "bg-primary/10",
    iconClassName: "bg-primary",
    titleClassName: "text-foreground",
  },
  warning: {
    confirmClassName:
      "border-amber-600 bg-amber-600 text-white hover:bg-amber-700",
    icon: "/svgs/alert.svg",
    iconBackgroundClassName: "bg-amber-50 dark:bg-amber-950/60",
    iconClassName: "bg-amber-600 dark:bg-amber-400",
    titleClassName: "text-amber-700 dark:text-amber-300",
  },
  destructive: {
    confirmClassName:
      "border-destructive bg-destructive text-destructive-foreground hover:bg-[var(--theme-danger)]",
    icon: "/svgs/error.svg",
    iconBackgroundClassName: "bg-red-50 dark:bg-red-950/60",
    iconClassName: "bg-destructive",
    titleClassName: "text-destructive",
  },
  success: {
    confirmClassName:
      "border-emerald-600 bg-emerald-600 text-white hover:bg-emerald-700",
    icon: "/svgs/success.svg",
    iconBackgroundClassName: "bg-emerald-50 dark:bg-emerald-950/60",
    iconClassName: "bg-emerald-600 dark:bg-emerald-400",
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
  variant = "information",
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
    trigger && isValidElement(trigger) ? (
      cloneElement(trigger as ReactElement<TriggerElementProps>, {
        onClick: (event: React.MouseEvent) => {
          (trigger as ReactElement<TriggerElementProps>).props.onClick?.(event);
          if (!event.defaultPrevented) setDialogOpen(true);
        },
      })
    ) : trigger ? (
      <button onClick={() => setDialogOpen(true)} type="button">
        {trigger}
      </button>
    ) : null;

  const dialog = isOpen ? (
    <>
      <button
        aria-label="بستن دیالوگ"
        className="fixed inset-0 z-[110] bg-black/50 backdrop-blur-sm"
        onClick={closeDialog}
        type="button"
      />
      <section
        aria-describedby={description ? descriptionId : undefined}
        aria-labelledby={titleId}
        aria-modal="true"
        className={joinClasses(
          "fixed left-1/2 top-1/2 z-[111] w-[calc(100%-2rem)] max-w-[480px] -translate-x-1/2 -translate-y-1/2 rounded border border-border bg-card p-5 text-card-foreground shadow-2xl sm:p-5",
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
              "flex h-11 w-11 shrink-0 items-center justify-center rounded-full",
              tone.iconBackgroundClassName,
            )}
          >
            <span
              className={joinClasses("h-[30px] w-[30px]", tone.iconClassName)}
              style={{
                WebkitMask: `url(${tone.icon}) center / contain no-repeat`,
                mask: `url(${tone.icon}) center / contain no-repeat`,
              }}
            />
          </span>
          <div className="min-w-0 flex-1">
            <h2
              className={joinClasses(
                "text-base font-bold leading-7 pt-2",
                tone.titleClassName,
              )}
              id={titleId}
            >
              {title}
            </h2>
            {description && (
              <div
                className="mt-1 text-sm leading-7 text-foreground pb-4 pt-2"
                id={descriptionId}
              >
                {description}
              </div>
            )}
          </div>
        </header>

        {children && (
          <div className="mt-4 text-sm leading-7 text-muted-foreground [&_[data-slot=alert]]:border-0 [&_[data-slot=alert]]:bg-transparent [&_[data-slot=alert]]:p-0 [&_[data-slot=alert]]:shadow-none [&_[data-slot=alert-description]]:text-muted-foreground [&_[data-slot=alert-icon]]:hidden [&_[data-slot=alert-title]]:text-foreground">
            {children}
          </div>
        )}

        <footer className="mt-5 flex flex-col gap-2 border-t border-border pt-4 sm:flex-row sm:justify-start">
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
          <KoochButton
            className="w-full sm:w-auto"
            onClick={closeDialog}
            ref={cancelButtonRef}
            type="button"
            variant="outline"
          >
            {cancelText}
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
