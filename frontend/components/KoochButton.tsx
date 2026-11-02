"use client";

import { createContext, forwardRef, useContext } from "react";
import type { ButtonHTMLAttributes, ReactNode } from "react";

type KoochButtonVariant = "primary" | "utility" | "outline" | "ghost" | "destructive";

type KoochButtonSize = "sm" | "md" | "lg" | "icon";

const KoochButtonAppearanceContext = createContext<"default" | "admin-light" | "admin-dark">("default");

// React context keeps the appearance scoped when dialog content renders through a portal.
export const KoochButtonAppearanceProvider = KoochButtonAppearanceContext.Provider;

const variantClass: Record<KoochButtonVariant, string> = {
  primary:
    "border border-primary bg-primary text-primary-foreground hover:bg-[var(--primary-hover)]",
  outline: "border border-border bg-background text-foreground hover:bg-muted",
  utility: "border border-border bg-background text-foreground hover:bg-muted",
  ghost:
    "border border-transparent bg-transparent text-foreground hover:bg-muted",
  destructive:
    "border border-destructive bg-destructive text-destructive-foreground hover:bg-[var(--theme-danger)]",
};

const adminVariantClass = {
  primary: "border kooch-admin-button kooch-admin-button-filled kooch-admin-button-primary",
  utility: "border kooch-admin-button kooch-admin-button-filled kooch-admin-button-utility",
  outline: "border kooch-admin-button kooch-admin-button-outline",
};

const sizeClass: Record<KoochButtonSize, string> = {
  sm: "min-h-9 px-3 py-1.5 text-xs",
  md: "min-h-10 px-4 py-2 text-sm",
  lg: "min-h-11 px-5 py-2.5 text-sm",
  icon: "h-10 w-10 p-0 text-sm [@media(pointer:coarse)]:min-w-11",
};

export type KoochButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  className?: string;
  leftIcon?: ReactNode;
  loading?: boolean;
  rightIcon?: ReactNode;
  size?: KoochButtonSize;
  variant?: KoochButtonVariant;
};

export const KoochButton = forwardRef<HTMLButtonElement, KoochButtonProps>(
  function KoochButton(
    {
      children,
      className = "",
      disabled,
      leftIcon,
      loading = false,
      rightIcon,
      size = "md",
      type = "button",
      variant = "primary",
      ...props
    },
    ref,
  ) {
    const appearance = useContext(KoochButtonAppearanceContext);
    const adminClasses = variant === "primary" || variant === "utility" || variant === "outline"
      ? adminVariantClass[variant] : null;
    const useAdminAppearance = appearance !== "default" && adminClasses !== null &&
      size !== "icon" && props["aria-pressed"] === undefined &&
      props["aria-selected"] === undefined && props.role !== "tab";
    const isDisabled = disabled || loading;

    return (
      <button
        className={[
          "inline-flex shrink-0 items-center justify-center gap-2 font-semibold disabled:pointer-events-none disabled:opacity-60 [@media(pointer:coarse)]:min-h-11",
          useAdminAppearance
            ? "rounded-lg transition-[background-color,border-color,color,box-shadow] duration-150 motion-reduce:transition-none"
            : "rounded-md transition",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
          useAdminAppearance ? adminClasses : variantClass[variant],
          sizeClass[size],
          className,
        ]
          .filter(Boolean)
          .join(" ")}
        disabled={isDisabled}
        data-kooch-button-theme={useAdminAppearance ? appearance === "admin-dark" ? "dark" : "light" : undefined}
        ref={ref}
        type={type}
        {...props}
      >
        {loading && (
          <span
            aria-hidden="true"
            className="h-4 w-4 animate-spin rounded border-2 border-current border-t-transparent"
          />
        )}
        {!loading && leftIcon}
        {children}
        {!loading && rightIcon}
      </button>
    );
  },
);
