import { forwardRef } from "react";
import type { InputHTMLAttributes, ReactNode } from "react";

function joinClasses(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

export type KoochCheckboxProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "type"
> & {
  label?: ReactNode;
  wrapperClassName?: string;
};

export const KoochCheckbox = forwardRef<HTMLInputElement, KoochCheckboxProps>(
  function KoochCheckbox(
    { className = "", disabled, label, wrapperClassName = "", ...props },
    ref,
  ) {
    return (
      <label
        className={joinClasses(
          "inline-flex items-center gap-2 text-sm font-semibold text-foreground",
          disabled && "cursor-not-allowed opacity-60",
          wrapperClassName,
        )}
      >
        <input
          className={joinClasses(
            "h-4 w-4 rounded border-border bg-background accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
            className,
          )}
          disabled={disabled}
          ref={ref}
          type="checkbox"
          {...props}
        />
        {label && <span>{label}</span>}
      </label>
    );
  },
);
