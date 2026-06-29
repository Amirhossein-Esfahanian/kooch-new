import type { ReactNode } from "react";

export type KoochPageHeaderProps = {
  actions?: ReactNode;
  className?: string;
  description?: ReactNode;
  eyebrow: ReactNode;
  title: ReactNode;
};

export function KoochPageHeader({
  actions,
  className = "",
  description,
  eyebrow,
  title,
}: KoochPageHeaderProps) {
  return (
    <header
      className={[
        "flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card p-5 text-card-foreground shadow-sm",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <div>
        <p className="text-xs font-bold text-muted-foreground">{eyebrow}</p>
        <h1 className="mt-1 text-2xl font-black tracking-tight text-foreground">{title}</h1>
        {description && (
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            {description}
          </p>
        )}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </header>
  );
}
