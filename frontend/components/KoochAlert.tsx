import type { HTMLAttributes, ReactNode } from "react";

type KoochAlertVariant = "default" | "warning" | "destructive" | "success";

const variantClass: Record<KoochAlertVariant, string> = {
  default: "border-border bg-muted text-foreground",
  warning:
    "border-yellow-500/25 bg-yellow-500/10 text-yellow-800 dark:text-yellow-200",
  destructive: "border-destructive/30 bg-destructive/10 text-destructive",
  success:
    "border-emerald-500/25 bg-emerald-500/10 text-emerald-800 dark:text-emerald-200",
};

export type KoochAlertProps = HTMLAttributes<HTMLDivElement> & {
  children: ReactNode;
  className?: string;
  title?: string;
  variant?: KoochAlertVariant;
};

export function KoochAlert({
  children,
  className = "",
  title,
  variant = "default",
  ...props
}: KoochAlertProps) {
  return (
    <div
      className={[
        "rounded-xl border p-4 text-sm font-semibold leading-6",
        variantClass[variant],
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      role={variant === "destructive" || variant === "warning" ? "alert" : undefined}
      {...props}
    >
      {title && <p className="mb-2 font-black">{title}</p>}
      {children}
    </div>
  );
}
