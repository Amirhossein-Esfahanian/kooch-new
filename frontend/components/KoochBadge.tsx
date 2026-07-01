import type { HTMLAttributes, ReactNode } from "react";

type KoochBadgeVariant =
  | "default"
  | "success"
  | "warning"
  | "destructive"
  | "muted";

const variantClass: Record<KoochBadgeVariant, string> = {
  default: "border-primary/25 bg-primary/10 text-primary",
  success:
    "border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  warning:
    "border-yellow-500/25 bg-yellow-500/10 text-yellow-700 dark:text-yellow-300",
  destructive: "border-destructive/25 bg-destructive/10 text-destructive",
  muted: "border-border bg-muted text-muted-foreground",
};

export type KoochBadgeProps = HTMLAttributes<HTMLSpanElement> & {
  children: ReactNode;
  className?: string;
  variant?: KoochBadgeVariant;
};

export function KoochBadge({
  children,
  className = "",
  variant = "default",
  ...props
}: KoochBadgeProps) {
  return (
    <span
      className={[
        "inline-flex items-center justify-center rounded-full border px-2.5 py-1 text-xs font-black",
        variantClass[variant],
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      {...props}
    >
      {children}
    </span>
  );
}
