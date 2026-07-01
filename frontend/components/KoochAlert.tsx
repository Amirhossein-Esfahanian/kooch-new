import type { CSSProperties, HTMLAttributes, ReactNode } from "react";

type KoochAlertVariant = "default" | "warning" | "destructive" | "success";

type KoochAlertIconName = "info" | "warning" | "success" | "error";

const alertIcons: Record<KoochAlertIconName, string> = {
  warning: "/svgs/alert.svg",
  info: "/svgs/info.svg",
  success: "/svgs/success.svg",
  error: "/svgs/error.svg",
};

const defaultIconByVariant: Record<KoochAlertVariant, KoochAlertIconName> = {
  default: "info",
  warning: "warning",
  destructive: "error",
  success: "success",
};

const variantClass: Record<KoochAlertVariant, string> = {
  default:
    "border-slate-500 bg-slate-50 text-slate-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-50",

  warning:
    "border-amber-700 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-50",

  destructive:
    "border-red-700 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-50",

  success:
    "border-emerald-700 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-50",
};

const titleClass: Record<KoochAlertVariant, string> = {
  default: "text-slate-500 dark:text-slate-50",
  warning: "text-amber-700 dark:text-amber-50",
  destructive: "text-red-700 dark:text-red-50",
  success: "text-emerald-700 dark:text-emerald-50",
};

export type KoochAlertProps = HTMLAttributes<HTMLDivElement> & {
  children: ReactNode;
  className?: string;
  icon?: KoochAlertIconName | null;
  title?: string;
  variant?: KoochAlertVariant;
};

function joinClasses(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

function KoochAlertIcon({ name }: { name: KoochAlertIconName }) {
  const iconPath = alertIcons[name];

  const iconStyle: CSSProperties = {
    WebkitMask: `url("${iconPath}") center / contain no-repeat`,
    mask: `url("${iconPath}") center / contain no-repeat`,
  };

  return (
    <span
      aria-hidden="true"
      className="mt-0.5 inline-block h-5 w-5 shrink-0 bg-current"
      style={iconStyle}
    />
  );
}

export function KoochAlert({
  children,
  className = "",
  icon,
  title,
  variant = "default",
  role,
  ...props
}: KoochAlertProps) {
  const iconName = icon === null ? null : icon || defaultIconByVariant[variant];
  const hasIcon = Boolean(iconName);

  return (
    <div
      data-slot="alert"
      role={
        role ??
        (variant === "destructive" || variant === "warning"
          ? "alert"
          : undefined)
      }
      className={joinClasses(
        "group/alert relative grid w-full gap-0.5 rounded-lg border px-2.5 py-2 text-right text-sm leading-8",
        hasIcon && "grid-cols-[auto_1fr] gap-x-2 ",
        variantClass[variant],
        className,
      )}
      {...props}
    >
      {iconName && <KoochAlertIcon name={iconName} />}

      {title && (
        <div
          data-slot="alert-title"
          className={joinClasses(
            "font-black [&_a]:underline [&_a]:underline-offset-4 [&_a]:hover:text-foreground",
            titleClass[variant],
            hasIcon && "col-start-2",
          )}
        >
          {title}
        </div>
      )}

      <div
        data-slot="alert-description"
        className={joinClasses(
          "text-sm font-semibold px-1 text-current [&_a]:underline [&_a]:underline-offset-4 [&_a]:hover:text-foreground [&_p:not(:last-child)]:mb-4",
          hasIcon && "col-start-2",
          !title && "font-semibold",
        )}
      >
        {children}
      </div>
    </div>
  );
}
