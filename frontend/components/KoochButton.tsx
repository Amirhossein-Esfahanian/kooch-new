import type { ButtonHTMLAttributes, ReactNode } from "react";

type KoochButtonVariant =
  | "primary"
  | "secondary"
  | "outline"
  | "ghost"
  | "destructive";

type KoochButtonSize = "sm" | "md" | "lg" | "icon";

const variantClass: Record<KoochButtonVariant, string> = {
  primary:
    "border border-primary bg-primary text-primary-foreground hover:bg-[var(--primary-hover)]",
  secondary:
    "border border-secondary bg-secondary text-secondary-foreground hover:bg-muted",
  outline: "border border-border bg-background text-foreground hover:bg-muted",
  ghost:
    "border border-transparent bg-transparent text-foreground hover:bg-muted",
  destructive:
    "border border-red-600 bg-red-600 text-white hover:bg-red-700 dark:border-red-500 dark:bg-red-600 dark:text-white dark:hover:bg-red-700",
};

const sizeClass: Record<KoochButtonSize, string> = {
  sm: "min-h-9 px-3 py-1.5 text-xs",
  md: "min-h-10 px-4 py-2 text-sm",
  lg: "min-h-11 px-5 py-2.5 text-base",
  icon: "h-10 w-10 p-0 text-sm",
};

export type KoochButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  className?: string;
  leftIcon?: ReactNode;
  loading?: boolean;
  rightIcon?: ReactNode;
  size?: KoochButtonSize;
  variant?: KoochButtonVariant;
};

export function KoochButton({
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
}: KoochButtonProps) {
  const isDisabled = disabled || loading;

  return (
    <button
      className={[
        "inline-flex shrink-0 items-center justify-center gap-2 rounded-lg font-bold transition disabled:pointer-events-none disabled:opacity-60",
        "focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-background",
        variantClass[variant],
        sizeClass[size],
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      disabled={isDisabled}
      type={type}
      {...props}
    >
      {loading && (
        <span
          aria-hidden="true"
          className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent"
        />
      )}
      {!loading && leftIcon}
      {children}
      {!loading && rightIcon}
    </button>
  );
}
