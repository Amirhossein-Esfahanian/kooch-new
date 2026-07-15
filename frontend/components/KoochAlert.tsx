import type { CSSProperties, HTMLAttributes, ReactNode } from "react";

export type KoochAlertVariant =
  | "default"
  | "info"
  | "information"
  | "question"
  | "warning"
  | "destructive"
  | "success";

type KoochAlertIconName = "info" | "question" | "warning" | "success" | "error";

type AlertTone = {
  iconBackgroundClassName: string;
  iconClassName: string;
  titleClassName: string;
};

const alertIcons: Record<KoochAlertIconName, string> = {
  warning: "/svgs/alert.svg",
  info: "/svgs/info.svg",
  question: "/svgs/circle-question.svg",
  success: "/svgs/success.svg",
  error: "/svgs/error.svg",
};

const defaultIconByVariant: Record<KoochAlertVariant, KoochAlertIconName> = {
  default: "info",
  info: "info",
  information: "info",
  question: "question",
  warning: "warning",
  destructive: "error",
  success: "success",
};

const variantTone: Record<KoochAlertVariant, AlertTone> = {
  default: {
    iconBackgroundClassName: "bg-muted",
    iconClassName: "bg-foreground",
    titleClassName: "text-foreground",
  },
  info: {
    iconBackgroundClassName: "bg-blue-50 dark:bg-blue-950/60",
    iconClassName: "bg-blue-600 dark:bg-blue-400",
    titleClassName: "text-foreground",
  },
  information: {
    iconBackgroundClassName: "bg-blue-50 dark:bg-blue-950/60",
    iconClassName: "bg-blue-600 dark:bg-blue-400",
    titleClassName: "text-foreground",
  },
  question: {
    iconBackgroundClassName: "bg-primary/10",
    iconClassName: "bg-primary",
    titleClassName: "text-foreground",
  },
  warning: {
    iconBackgroundClassName: "bg-amber-50 dark:bg-amber-950/60",
    iconClassName: "bg-amber-600 dark:bg-amber-400",
    titleClassName: "text-amber-700 dark:text-amber-300",
  },
  destructive: {
    iconBackgroundClassName: "bg-red-50 dark:bg-red-950/60",
    iconClassName: "bg-destructive",
    titleClassName: "text-destructive",
  },
  success: {
    iconBackgroundClassName: "bg-emerald-50 dark:bg-emerald-950/60",
    iconClassName: "bg-emerald-600 dark:bg-emerald-400",
    titleClassName: "text-emerald-700 dark:text-emerald-300",
  },
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

function KoochAlertIcon({
  name,
  tone,
}: {
  name: KoochAlertIconName;
  tone: AlertTone;
}) {
  const iconStyle: CSSProperties = {
    WebkitMask: `url("${alertIcons[name]}") center / contain no-repeat`,
    mask: `url("${alertIcons[name]}") center / contain no-repeat`,
  };

  return (
    <span
      aria-hidden="true"
      className={joinClasses(
        "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg",
        tone.iconBackgroundClassName,
      )}
      data-slot="alert-icon"
    >
      <span
        className={joinClasses("h-[18px] w-[18px]", tone.iconClassName)}
        style={iconStyle}
      />
    </span>
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
  const tone = variantTone[variant];

  return (
    <div
      className={joinClasses(
        "flex w-full items-start gap-3 rounded-lg border border-border bg-card px-3 py-3 text-right text-card-foreground shadow-sm",
        className,
      )}
      data-slot="alert"
      dir="rtl"
      role={
        role ??
        (variant === "destructive" || variant === "warning"
          ? "alert"
          : undefined)
      }
      {...props}
    >
      <div className="min-w-0 flex-1" data-slot="alert-content">
        {title && (
          <div
            className={joinClasses(
              "text-sm font-black leading-6 [&_a]:underline [&_a]:underline-offset-4",
              tone.titleClassName,
            )}
            data-slot="alert-title"
          >
            {title}
          </div>
        )}

        <div
          className={joinClasses(
            "text-sm font-medium leading-7 text-muted-foreground [&_a]:underline [&_a]:underline-offset-4 [&_a]:hover:text-foreground [&_p:not(:last-child)]:mb-3",
            title && "mt-0.5",
          )}
          data-slot="alert-description"
        >
          {children}
        </div>
      </div>

      {iconName && <KoochAlertIcon name={iconName} tone={tone} />}
    </div>
  );
}
