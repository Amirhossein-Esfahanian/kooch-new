"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type HTMLAttributes,
  type InputHTMLAttributes,
  type LabelHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";

type FieldStateProps = {
  error?: ReactNode;
  helperText?: ReactNode;
};

type InvalidStateProps = {
  error?: ReactNode;
};

function joinClasses(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

const controlClass =
  "flex w-full rounded-md border border-border bg-background text-foreground shadow-sm transition placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50 aria-[invalid=true]:border-destructive aria-[invalid=true]:focus-visible:ring-destructive";

export type KoochInputProps = InputHTMLAttributes<HTMLInputElement> &
  InvalidStateProps & {
    className?: string;
    selectOnFocus?: boolean;
  };

export function KoochInput({
  selectOnFocus = false,
  onFocus,
  className = "",
  error,
  ...props
}: KoochInputProps) {
  return (
    <input
      onFocus={(event) => {
        if (selectOnFocus) {
          event.currentTarget.select();
        }

        onFocus?.(event);
      }}
      aria-invalid={Boolean(error) || undefined}
      className={joinClasses("h-10 px-3 py-2 text-sm", controlClass, className)}
      {...props}
    />
  );
}

export type KoochSelectProps = SelectHTMLAttributes<HTMLSelectElement> &
  InvalidStateProps & {
    className?: string;
  };

export function KoochSelect({
  children,
  className = "",
  error,
  ...props
}: KoochSelectProps) {
  return (
    <select
      aria-invalid={Boolean(error) || undefined}
      className={joinClasses("h-10 px-3 py-2 text-sm", controlClass, className)}
      {...props}
    >
      {children}
    </select>
  );
}

export type KoochTextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement> &
  InvalidStateProps & {
    className?: string;
  };

export function KoochTextarea({
  className = "",
  error,
  rows = 4,
  ...props
}: KoochTextareaProps) {
  return (
    <textarea
      aria-invalid={Boolean(error) || undefined}
      className={joinClasses(
        "min-h-28 px-3 py-2 text-sm",
        controlClass,
        className,
      )}
      rows={rows}
      {...props}
    />
  );
}

export type KoochLabelProps = LabelHTMLAttributes<HTMLLabelElement> & {
  className?: string;
  required?: boolean;
};

export function KoochLabel({
  children,
  className = "",
  required = false,
  ...props
}: KoochLabelProps) {
  return (
    <label
      className={joinClasses(
        "text-sm font-semibold text-foreground",
        className,
      )}
      {...props}
    >
      {children}
      {required && <span className="mr-1 text-destructive">*</span>}
    </label>
  );
}

export type KoochFieldProps = HTMLAttributes<HTMLDivElement> &
  FieldStateProps & {
    children: ReactNode;
    className?: string;
    label?: ReactNode;
    required?: boolean;
  };

export function KoochField({
  children,
  className = "",
  error,
  helperText,
  label,
  required = false,
  ...props
}: KoochFieldProps) {
  return (
    <div className={joinClasses("grid gap-2", className)} {...props}>
      {label && <KoochLabel required={required}>{label}</KoochLabel>}
      {children}
      <KoochFieldMessage error={error} helperText={helperText} />
    </div>
  );
}

function KoochFieldMessage({ error, helperText }: FieldStateProps) {
  if (error) {
    return <p className="text-xs font-medium text-destructive">{error}</p>;
  }

  if (helperText) {
    return (
      <p className="text-xs font-medium text-muted-foreground">{helperText}</p>
    );
  }

  return null;
}

export type KoochCheckboxProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "type"
> &
  InvalidStateProps & {
    label?: ReactNode;
    helperText?: ReactNode;
    containerClassName?: string;
    labelClassName?: string;
    indicatorClassName?: string;

    boxBorder?: boolean;
    boxBackground?: boolean;
    checkedBoxBorder?: boolean;
    checkedBoxBackground?: boolean;

    containerBorder?: boolean;
    containerBackground?: boolean;
    checkedContainerBorder?: boolean;
    checkedContainerBackground?: boolean;
  };

export function KoochCheckbox({
  label,
  helperText,
  className = "",
  containerClassName = "",
  labelClassName = "",
  indicatorClassName = "",
  boxBorder = true,
  boxBackground = true,
  checkedBoxBorder = true,
  checkedBoxBackground = true,
  containerBorder = false,
  containerBackground = false,
  checkedContainerBorder = false,
  checkedContainerBackground = false,
  error,
  disabled,
  checked,
  defaultChecked,
  onChange,
  ...props
}: KoochCheckboxProps) {
  const isControlled = checked !== undefined;
  const [internalChecked, setInternalChecked] = useState(
    Boolean(defaultChecked),
  );
  const isChecked = isControlled ? Boolean(checked) : internalChecked;

  return (
    <label
      className={joinClasses(
        "group flex cursor-pointer items-start gap-2 rounded-md text-sm text-foreground transition",
        containerBorder || checkedContainerBorder
          ? "border"
          : "border border-transparent",
        isChecked
          ? checkedContainerBorder
            ? "border-primary"
            : "border-transparent"
          : containerBorder
            ? "border-border"
            : "border-transparent",
        isChecked
          ? checkedContainerBackground
            ? "bg-primary/10"
            : "bg-transparent"
          : containerBackground
            ? "bg-background"
            : "bg-transparent",
        disabled && "cursor-not-allowed opacity-60",
        containerClassName,
      )}
    >
      <input
        aria-invalid={Boolean(error) || undefined}
        checked={checked}
        className="peer sr-only"
        defaultChecked={defaultChecked}
        disabled={disabled}
        onChange={(event) => {
          if (!isControlled) {
            setInternalChecked(event.currentTarget.checked);
          }

          onChange?.(event);
        }}
        type="checkbox"
        {...props}
      />

      <span
        aria-hidden="true"
        className={joinClasses(
          "mt-0.5 grid h-5 w-5 shrink-0 place-items-center  border text-xs font-normal text-transparent shadow-sm transition-colors duration-150",
          boxBorder ? "border-border" : "border-transparent",
          boxBackground ? "bg-background" : "bg-transparent",
          "peer-focus-visible:outline-none peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-background",
          checkedBoxBorder
            ? "peer-checked:border-primary"
            : "peer-checked:border-transparent",
          checkedBoxBackground
            ? "peer-checked:bg-primary peer-checked:text-primary-foreground"
            : "peer-checked:bg-transparent peer-checked:text-primary",
          !disabled &&
            "group-hover:!bg-primary/20 peer-checked:group-hover:!bg-primary/75",
          "peer-disabled:cursor-not-allowed peer-disabled:opacity-50",
          Boolean(error) &&
            "border-destructive peer-focus-visible:ring-destructive",
          className,
        )}
      >
        <span className={indicatorClassName}>✓</span>
      </span>

      {(label || error || helperText) && (
        <span className="grid min-w-0 gap-1 leading-5">
          {label && (
            <span className={joinClasses("font-normal", labelClassName)}>
              {label}
            </span>
          )}

          {error ? (
            <span className="text-xs font-medium text-destructive">
              {error}
            </span>
          ) : helperText ? (
            <span className="text-xs font-medium text-muted-foreground">
              {helperText}
            </span>
          ) : null}
        </span>
      )}
    </label>
  );
}

type KoochMultiSelectValue = string | number;

export type KoochMultiSelectOption = {
  value: KoochMultiSelectValue;
  label: ReactNode;
  description?: ReactNode;
  searchText?: string;
  disabled?: boolean;
};

export type KoochMultiSelectProps = FieldStateProps & {
  options: KoochMultiSelectOption[];
  value: KoochMultiSelectValue[];
  onChange: (value: KoochMultiSelectValue[]) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  selectAllText?: string;
  clearText?: string;
  disabled?: boolean;
  className?: string;
  dropdownClassName?: string;
};

function optionKey(value: KoochMultiSelectValue) {
  return String(value);
}

function optionMatchesValue(
  first: KoochMultiSelectValue,
  second: KoochMultiSelectValue,
) {
  return String(first) === String(second);
}

function optionSearchText(option: KoochMultiSelectOption) {
  if (option.searchText) return option.searchText;
  if (typeof option.label === "string") return option.label;
  if (typeof option.label === "number") return String(option.label);
  return String(option.value);
}

export function KoochMultiSelect({
  options,
  value,
  onChange,
  placeholder = "انتخاب کنید",
  searchPlaceholder = "جستجو...",
  emptyText = "موردی پیدا نشد.",
  selectAllText = "انتخاب همه",
  clearText = "حذف همه",
  disabled = false,
  className = "",
  dropdownClassName = "",
  error,
  helperText,
}: KoochMultiSelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: PointerEvent) {
      if (!wrapperRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [open]);

  const enabledOptions = useMemo(
    () => options.filter((option) => !option.disabled),
    [options],
  );

  const selectedOptions = useMemo(
    () =>
      value
        .map((selectedValue) =>
          options.find((option) =>
            optionMatchesValue(option.value, selectedValue),
          ),
        )
        .filter((option): option is KoochMultiSelectOption => Boolean(option)),
    [options, value],
  );

  const filteredOptions = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return options;

    return options.filter((option) =>
      optionSearchText(option).toLowerCase().includes(normalizedQuery),
    );
  }, [options, query]);

  function isSelected(optionValue: KoochMultiSelectValue) {
    return value.some((selectedValue) =>
      optionMatchesValue(selectedValue, optionValue),
    );
  }

  function toggleOption(option: KoochMultiSelectOption) {
    if (option.disabled || disabled) return;

    if (isSelected(option.value)) {
      onChange(
        value.filter(
          (selectedValue) => !optionMatchesValue(selectedValue, option.value),
        ),
      );
      return;
    }

    onChange([...value, option.value]);
  }

  function selectAll() {
    if (disabled) return;
    onChange(enabledOptions.map((option) => option.value));
  }

  function clearAll() {
    if (disabled) return;
    onChange([]);
  }

  return (
    <div className="grid gap-1.5" dir="rtl">
      <div className="relative" ref={wrapperRef}>
        <button
          aria-expanded={open}
          aria-invalid={Boolean(error) || undefined}
          className={joinClasses(
            "flex min-h-10 w-full items-center justify-between gap-2 rounded-md border border-border bg-background px-3 py-2 text-right text-sm text-foreground shadow-sm transition hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50 aria-[invalid=true]:border-destructive aria-[invalid=true]:focus-visible:ring-destructive",
            className,
          )}
          disabled={disabled}
          onClick={() => setOpen((current) => !current)}
          type="button"
        >
          <span className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
            {selectedOptions.length === 0 ? (
              <span className="truncate text-muted-foreground">
                {placeholder}
              </span>
            ) : selectedOptions.length <= 3 ? (
              selectedOptions.map((option) => (
                <span
                  className="inline-flex max-w-36 items-center rounded-md bg-primary/10 px-2 py-0.5 text-xs font-bold text-foreground ring-1 ring-inset ring-primary/30"
                  key={optionKey(option.value)}
                >
                  <span className="truncate">{option.label}</span>
                </span>
              ))
            ) : (
              <span className="rounded-md bg-primary/10 px-2 py-0.5 text-xs font-bold text-foreground ring-1 ring-inset ring-primary/30">
                {selectedOptions.length.toLocaleString("fa-IR")} مورد انتخاب شده
              </span>
            )}
          </span>

          <span className="shrink-0 text-muted-foreground">
            {open ? "⌃" : "⌄"}
          </span>
        </button>

        {open && (
          <div
            className={joinClasses(
              "absolute right-0 top-[calc(100%+0.375rem)] z-50 w-full overflow-hidden rounded-lg border border-border bg-popover text-popover-foreground shadow-2xl",
              dropdownClassName,
            )}
          >
            <div className="border-b border-border p-2">
              <KoochInput
                className="h-9"
                onChange={(event) => setQuery(event.target.value)}
                placeholder={searchPlaceholder}
                value={query}
              />
            </div>

            <div className="flex items-center justify-between gap-2 border-b border-border p-2">
              <button
                className="text-xs font-bold text-primary hover:underline disabled:cursor-not-allowed disabled:opacity-50"
                disabled={disabled || enabledOptions.length === 0}
                onClick={selectAll}
                type="button"
              >
                {selectAllText}
              </button>

              <button
                className="text-xs font-bold text-destructive hover:underline disabled:cursor-not-allowed disabled:opacity-50"
                disabled={disabled || value.length === 0}
                onClick={clearAll}
                type="button"
              >
                {clearText}
              </button>
            </div>

            <div className="max-h-64 overflow-y-auto p-1.5">
              {filteredOptions.length === 0 ? (
                <p className="px-2 py-3 text-xs font-semibold text-muted-foreground">
                  {emptyText}
                </p>
              ) : (
                filteredOptions.map((option) => {
                  const checked = isSelected(option.value);

                  return (
                    <button
                      aria-pressed={checked}
                      className={joinClasses(
                        "flex w-full items-start justify-between gap-3 rounded-lg px-2.5 py-2 text-right text-sm font-semibold transition",
                        checked
                          ? "bg-primary/10 text-foreground"
                          : "hover:bg-muted",
                        option.disabled &&
                          "cursor-not-allowed opacity-50 hover:bg-transparent",
                      )}
                      disabled={option.disabled}
                      key={optionKey(option.value)}
                      onClick={() => toggleOption(option)}
                      type="button"
                    >
                      <span className="grid min-w-0 gap-0.5">
                        <span className="truncate">{option.label}</span>

                        {option.description && (
                          <span className="truncate text-xs font-medium text-muted-foreground">
                            {option.description}
                          </span>
                        )}
                      </span>

                      <span
                        aria-hidden="true"
                        className={joinClasses(
                          "grid h-5 w-5 shrink-0 place-items-center rounded-md border text-xs font-black transition",
                          checked
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-border bg-background text-transparent",
                        )}
                      >
                        ✓
                      </span>
                    </button>
                  );
                })
              )}
            </div>
          </div>
        )}
      </div>

      <KoochFieldMessage error={error} helperText={helperText} />
    </div>
  );
}
