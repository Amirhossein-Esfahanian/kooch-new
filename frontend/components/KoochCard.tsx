import type { HTMLAttributes, ReactNode } from "react";

type KoochCardPadding = "none" | "sm" | "md" | "lg";
type KoochCardVariant = "default" | "muted" | "elevated";

const paddingClass: Record<KoochCardPadding, string> = {
  none: "p-0",
  sm: "p-3",
  md: "p-5",
  lg: "p-6",
};

const variantClass: Record<KoochCardVariant, string> = {
  default: "bg-card",
  muted: "bg-muted",
  elevated: "bg-card shadow-sm",
};

export type KoochCardProps = HTMLAttributes<HTMLElement> & {
  children: ReactNode;
  className?: string;
  padding?: KoochCardPadding;
  variant?: KoochCardVariant;
};

export function KoochCard({
  children,
  className = "",
  padding = "md",
  variant = "default",
  ...props
}: KoochCardProps) {
  return (
    <section
      className={[
        "rounded-xl border border-border text-card-foreground",
        paddingClass[padding],
        variantClass[variant],
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      {...props}
    >
      {children}
    </section>
  );
}
