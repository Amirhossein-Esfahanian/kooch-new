"use client";

import { useId, type ReactNode } from "react";
import { KoochCheckbox } from "@/components/KoochFormControls";

type WeekdayValue = string | number;

export type KoochWeekdayOption<T extends WeekdayValue> = {
  value: T;
  label: ReactNode;
};

export type KoochWeekdaySelectorProps<T extends WeekdayValue> = {
  options: readonly KoochWeekdayOption<T>[];
  value: readonly T[];
  onChange: (value: T[]) => void;
  label?: ReactNode | null;
  required?: boolean;
  error?: string;
  disabled?: boolean;
  selectAllText?: string;
  clearText?: string;
  className?: string;
};

export function KoochWeekdaySelector<T extends WeekdayValue>({
  options,
  value,
  onChange,
  label = "روزهای هفته",
  required = false,
  error,
  disabled = false,
  selectAllText = "انتخاب همه",
  clearText = "حذف همه",
  className = "",
}: KoochWeekdaySelectorProps<T>) {
  const labelId = useId();

  function toggle(optionValue: T) {
    if (disabled) return;

    onChange(
      value.includes(optionValue)
        ? value.filter((item) => item !== optionValue)
        : [...value, optionValue],
    );
  }

  function selectAll() {
    if (disabled) return;
    onChange(options.map((option) => option.value));
  }

  function clearAll() {
    if (disabled) return;
    onChange([]);
  }

  return (
    <div
      aria-labelledby={label ? labelId : undefined}
      className={`grid gap-2 ${className}`}
      role="group"
    >
      <div
        className={`flex items-center gap-3 ${
          label ? "justify-between" : "justify-start"
        }`}
      >
        {label && (
          <span
            className="text-xs font-semibold text-muted-foreground"
            id={labelId}
          >
            {label}
            {required && (
              <span aria-hidden="true" className="mr-1 text-destructive">
                *
              </span>
            )}
          </span>
        )}

        <div className="flex items-center gap-2 text-xs">
          <button
            className="font-semibold text-primary transition hover:underline disabled:cursor-not-allowed disabled:opacity-50"
            disabled={disabled}
            onClick={selectAll}
            type="button"
          >
            {selectAllText}
          </button>
          <button
            className="font-semibold text-destructive transition hover:underline disabled:cursor-not-allowed disabled:opacity-50"
            disabled={disabled}
            onClick={clearAll}
            type="button"
          >
            {clearText}
          </button>
        </div>
      </div>

      <div className="grid w-full grid-cols-2 gap-2 rounded-lg border border-border bg-muted/40 p-3 sm:grid-cols-4 md:grid-cols-7">
        {options.map((option) => {
          const checked = value.includes(option.value);

          return (
            <KoochCheckbox
              boxBackground
              boxBorder
              checked={checked}
              className="h-4 w-4 rounded"
              containerClassName="rounded-lg border border-border bg-background p-2 transition"
              disabled={disabled}
              key={String(option.value)}
              label={option.label}
              labelClassName="text-xs font-semibold"
              onChange={() => toggle(option.value)}
            />
          );
        })}
      </div>

      {error && (
        <p className="text-xs font-medium text-destructive" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

export default KoochWeekdaySelector;
