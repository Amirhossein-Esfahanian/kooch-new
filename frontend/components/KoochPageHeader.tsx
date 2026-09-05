import type { ReactNode } from "react";

export type KoochPageHeaderProps = {
  actions?: ReactNode;
  appearance?: "card" | "plain";
  breadcrumb?: ReactNode;
  className?: string;
  description?: ReactNode;
  eyebrow: ReactNode;
  title: ReactNode;
};

export function KoochPageHeader({
  actions,
  appearance = "card",
  breadcrumb,
  className = "",
  description,
  eyebrow,
  title,
}: KoochPageHeaderProps) {
  const isPlain = appearance === "plain";

  return (
    <header
      className={[
        "flex flex-wrap items-center justify-between gap-3",
        isPlain
          ? "py-1 text-foreground"
          : "rounded-xl border border-border bg-card p-5 text-card-foreground shadow-sm",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <div className="min-w-0">
        {isPlain && breadcrumb ? (
          <nav aria-label="مسیر صفحه">
            <ol className="flex flex-wrap items-center gap-1.5 text-xs font-normal text-muted-foreground">
              {breadcrumb}
            </ol>
          </nav>
        ) : isPlain ? (
          <p
            className="text-xs font-normal text-muted-foreground"
            data-slot="page-breadcrumb"
          >
            {eyebrow}
          </p>
        ) : (
          <p className="text-xs font-bold text-muted-foreground">{eyebrow}</p>
        )}
        <h1
          className={[
            "mt-1 tracking-tight text-foreground",
            isPlain
              ? "text-xl font-semibold sm:text-2xl"
              : "text-2xl font-bold",
          ].join(" ")}
        >
          {title}
        </h1>
        {description && (
          <p
            className={
              isPlain
                ? "mt-1 max-w-3xl text-sm font-normal leading-6 text-muted-foreground"
                : "mt-2 text-sm leading-6 text-muted-foreground"
            }
          >
            {description}
          </p>
        )}
      </div>
      {actions && (
        <div className="flex flex-wrap items-center gap-2">{actions}</div>
      )}
    </header>
  );
}
