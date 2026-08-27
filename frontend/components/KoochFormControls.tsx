"use client";

import {
  cloneElement,
  Fragment,
  forwardRef,
  isValidElement,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type AriaAttributes,
  type HTMLAttributes,
  type InputHTMLAttributes,
  type LabelHTMLAttributes,
  type KeyboardEvent,
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

type AccessibleControlProps = Pick<
  AriaAttributes,
  "aria-describedby" | "aria-invalid"
> & {
  id?: string;
};

const labelableTags = new Set([
  "button",
  "input",
  "meter",
  "output",
  "progress",
  "select",
  "textarea",
]);

function joinClasses(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

function mergeAriaIds(...values: Array<string | undefined>) {
  const ids = values.flatMap(
    (value) => value?.split(/\s+/).filter(Boolean) ?? [],
  );
  return [...new Set(ids)].join(" ") || undefined;
}

function resolveAriaInvalid(
  error: ReactNode,
  ariaInvalid: AriaAttributes["aria-invalid"],
) {
  if (Boolean(error)) return true;
  if (ariaInvalid === false || ariaInvalid === "false") return undefined;
  return ariaInvalid;
}

const controlClass =
  "kooch-form-control flex w-full transition disabled:opacity-50";

export type KoochInputProps = InputHTMLAttributes<HTMLInputElement> &
  InvalidStateProps & {
    className?: string;
    selectOnFocus?: boolean;
  };

export const KoochInput = forwardRef<HTMLInputElement, KoochInputProps>(
  function KoochInput(
    {
      selectOnFocus = false,
      onFocus,
      className = "",
      error,
      id,
      "aria-describedby": ariaDescribedBy,
      "aria-invalid": ariaInvalid,
      ...props
    },
    ref,
  ) {
    const generatedId = useId();

    return (
      <input
        onFocus={(event) => {
          if (selectOnFocus) {
            event.currentTarget.select();
          }

          onFocus?.(event);
        }}
        aria-describedby={ariaDescribedBy}
        aria-invalid={resolveAriaInvalid(error, ariaInvalid)}
        className={joinClasses(
          "h-10 px-3 py-2 text-sm",
          controlClass,
          className,
        )}
        id={id ?? `kooch-input-${generatedId}`}
        ref={ref}
        {...props}
      />
    );
  },
);

export type KoochSelectProps = SelectHTMLAttributes<HTMLSelectElement> &
  InvalidStateProps & {
    className?: string;
  };

export function KoochSelect({
  children,
  className = "",
  error,
  id,
  "aria-describedby": ariaDescribedBy,
  "aria-invalid": ariaInvalid,
  ...props
}: KoochSelectProps) {
  const generatedId = useId();

  return (
    <select
      aria-describedby={ariaDescribedBy}
      aria-invalid={resolveAriaInvalid(error, ariaInvalid)}
      className={joinClasses("h-10 px-3 py-2 text-sm", controlClass, className)}
      id={id ?? `kooch-select-${generatedId}`}
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
  id,
  rows = 4,
  "aria-describedby": ariaDescribedBy,
  "aria-invalid": ariaInvalid,
  ...props
}: KoochTextareaProps) {
  const generatedId = useId();

  return (
    <textarea
      aria-describedby={ariaDescribedBy}
      aria-invalid={resolveAriaInvalid(error, ariaInvalid)}
      className={joinClasses(
        "min-h-28 px-3 py-2 text-sm",
        controlClass,
        className,
      )}
      id={id ?? `kooch-textarea-${generatedId}`}
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
  const generatedId = useId();
  const controlElement = isValidElement<AccessibleControlProps>(children)
    ? children
    : null;
  const controlId = controlElement?.props.id ?? `kooch-field-${generatedId}`;
  const labelId = `${controlId}-label`;
  const messageId = error || helperText ? `${controlId}-message` : undefined;
  const usesGroupSemantics =
    !controlElement ||
    controlElement.type === Fragment ||
    (typeof controlElement.type === "string" &&
      !labelableTags.has(controlElement.type));
  const controlDescribedBy = mergeAriaIds(
    controlElement?.props["aria-describedby"],
    messageId,
  );
  const controlAriaInvalid = resolveAriaInvalid(
    error,
    controlElement?.props["aria-invalid"],
  );
  const enhancedChildren =
    controlElement && !usesGroupSemantics
      ? cloneElement(controlElement, {
          "aria-describedby": controlDescribedBy,
          "aria-invalid": controlAriaInvalid,
          id: controlId,
        })
      : children;
  const {
    "aria-describedby": groupDescribedBy,
    "aria-invalid": groupAriaInvalid,
    "aria-labelledby": groupLabelledBy,
    role,
    ...containerProps
  } = props;

  return (
    <div
      aria-describedby={
        usesGroupSemantics
          ? mergeAriaIds(groupDescribedBy, messageId)
          : groupDescribedBy
      }
      aria-invalid={
        usesGroupSemantics
          ? resolveAriaInvalid(error, groupAriaInvalid)
          : resolveAriaInvalid(undefined, groupAriaInvalid)
      }
      aria-labelledby={
        usesGroupSemantics && label
          ? mergeAriaIds(groupLabelledBy, labelId)
          : groupLabelledBy
      }
      className={joinClasses("grid gap-2", className)}
      role={usesGroupSemantics && label ? (role ?? "group") : role}
      {...containerProps}
    >
      {label && (
        <KoochLabel
          htmlFor={usesGroupSemantics ? undefined : controlId}
          id={labelId}
          required={required}
        >
          {label}
        </KoochLabel>
      )}
      {enhancedChildren}
      <KoochFieldMessage error={error} helperText={helperText} id={messageId} />
    </div>
  );
}

function KoochFieldMessage({
  error,
  helperText,
  id,
}: FieldStateProps & { id?: string }) {
  if (error) {
    return (
      <p
        aria-atomic="true"
        className="text-xs font-medium text-destructive"
        id={id}
        role="alert"
      >
        {error}
      </p>
    );
  }

  if (helperText) {
    return (
      <p className="text-xs font-medium text-muted-foreground" id={id}>
        {helperText}
      </p>
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
  id,
  onChange,
  "aria-describedby": ariaDescribedBy,
  "aria-invalid": ariaInvalid,
  ...props
}: KoochCheckboxProps) {
  const generatedId = useId();
  const isControlled = checked !== undefined;
  const [internalChecked, setInternalChecked] = useState(
    Boolean(defaultChecked),
  );
  const isChecked = isControlled ? Boolean(checked) : internalChecked;
  const controlId = id ?? `kooch-checkbox-${generatedId}`;
  const messageId = error || helperText ? `${controlId}-message` : undefined;

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
        aria-describedby={mergeAriaIds(ariaDescribedBy, messageId)}
        aria-invalid={resolveAriaInvalid(error, ariaInvalid)}
        checked={checked}
        className="peer sr-only"
        defaultChecked={defaultChecked}
        disabled={disabled}
        id={controlId}
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
            <span
              aria-atomic="true"
              className="text-xs font-medium text-destructive"
              id={messageId}
              role="alert"
            >
              {error}
            </span>
          ) : helperText ? (
            <span
              className="text-xs font-medium text-muted-foreground"
              id={messageId}
            >
              {helperText}
            </span>
          ) : null}
        </span>
      )}
    </label>
  );
}

type KoochMultiSelectValue = string | number;
type KoochSelectValue = string | number;

export type KoochMultiSelectOption = {
  value: KoochMultiSelectValue;
  label: ReactNode;
  description?: ReactNode;
  searchText?: string;
  disabled?: boolean;
};

export type KoochSearchableSelectOption = {
  value: KoochSelectValue;
  label: ReactNode;
  description?: ReactNode;
  group?: string;
  searchText?: string;
  disabled?: boolean;
};

export type KoochMultiSelectProps = FieldStateProps &
  AccessibleControlProps & {
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

export type KoochSearchableSelectProps = FieldStateProps &
  AccessibleControlProps & {
    options: KoochSearchableSelectOption[];
    value: KoochSelectValue | "";
    onChange: (value: string) => void;
    placeholder?: string;
    searchPlaceholder?: string;
    emptyText?: string;
    clearText?: string;
    disabled?: boolean;
    className?: string;
    dropdownClassName?: string;
    onSearchChange?: (query: string) => void;
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

function searchableOptionSearchText(option: KoochSearchableSelectOption) {
  if (option.searchText) return option.searchText;
  if (typeof option.label === "string") return option.label;
  if (typeof option.label === "number") return String(option.label);
  return String(option.value);
}

export function KoochSearchableSelect({
  options,
  value,
  onChange,
  placeholder = "انتخاب کنید",
  searchPlaceholder = "جستجو...",
  emptyText = "موردی پیدا نشد.",
  clearText = "پاک کردن",
  disabled = false,
  className = "",
  dropdownClassName = "",
  onSearchChange,
  error,
  helperText,
  id,
  "aria-describedby": ariaDescribedBy,
  "aria-invalid": ariaInvalid,
}: KoochSearchableSelectProps) {
  const generatedId = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const selectedOption = options.find((option) =>
    optionMatchesValue(option.value, value),
  );
  const controlId = id ?? `kooch-searchable-select-${generatedId}`;
  const messageId = error || helperText ? `${controlId}-message` : undefined;

  const filteredOptions = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase("fa-IR");
    if (!normalizedQuery) return options;

    return options.filter((option) =>
      searchableOptionSearchText(option)
        .toLocaleLowerCase("fa-IR")
        .includes(normalizedQuery),
    );
  }, [options, query]);

  const selectableOptions = filteredOptions.filter(
    (option) => !option.disabled,
  );
  const activeOption = selectableOptions[activeIndex];

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

  useEffect(() => {
    if (!open) {
      setQuery("");
      setActiveIndex(0);
      return;
    }

    window.setTimeout(() => searchRef.current?.focus(), 0);
  }, [open]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  function selectOption(option: KoochSearchableSelectOption | undefined) {
    if (!option || option.disabled || disabled) return;

    onChange(String(option.value));
    setOpen(false);
  }

  function clearValue() {
    if (disabled) return;

    onChange("");
    setOpen(false);
  }

  function updateQuery(nextQuery: string) {
    setQuery(nextQuery);
    onSearchChange?.(nextQuery);
  }

  function handleKeyDown(event: KeyboardEvent) {
    if (disabled) return;

    if (!open && ["ArrowDown", "ArrowUp", "Enter", " "].includes(event.key)) {
      event.preventDefault();
      setOpen(true);
      return;
    }

    if (
      !open &&
      selectedOption &&
      ["Backspace", "Delete"].includes(event.key)
    ) {
      event.preventDefault();
      clearValue();
      return;
    }

    if (!open) return;

    if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((current) =>
        selectableOptions.length === 0
          ? 0
          : Math.min(current + 1, selectableOptions.length - 1),
      );
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((current) => Math.max(current - 1, 0));
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      selectOption(activeOption);
    }
  }

  return (
    <div className="grid gap-1.5" dir="rtl">
      <div className="relative" ref={wrapperRef}>
        <button
          aria-describedby={mergeAriaIds(ariaDescribedBy, messageId)}
          aria-expanded={open}
          aria-invalid={resolveAriaInvalid(error, ariaInvalid)}
          className={joinClasses(
            "kooch-form-control flex min-h-10 w-full items-center justify-between gap-2 px-3 py-2 text-right text-sm transition disabled:opacity-50",
            className,
          )}
          data-control-active={open ? "true" : undefined}
          disabled={disabled}
          id={controlId}
          onClick={() => setOpen((current) => !current)}
          onKeyDown={handleKeyDown}
          type="button"
        >
          <span className="grid min-w-0 flex-1 gap-0.5 text-right">
            <span
              className={joinClasses(
                "truncate",
                !selectedOption && "text-muted-foreground",
              )}
            >
              {selectedOption ? selectedOption.label : placeholder}
            </span>
            {selectedOption?.description && (
              <span className="truncate text-xs font-medium text-muted-foreground">
                {selectedOption.description}
              </span>
            )}
          </span>

          <span className="flex shrink-0 items-center gap-1 text-muted-foreground">
            {selectedOption && (
              <span
                aria-label={clearText}
                className="grid h-6 w-6 place-items-center rounded-md text-base leading-none transition hover:bg-destructive/10 hover:text-destructive"
                onClick={(event) => {
                  event.stopPropagation();
                  clearValue();
                }}
                role="button"
                tabIndex={-1}
              >
                ×
              </span>
            )}
            <span aria-hidden="true">{open ? "⌃" : "⌄"}</span>
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
                onChange={(event) => updateQuery(event.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={searchPlaceholder}
                ref={searchRef}
                value={query}
              />
            </div>

            <div className="max-h-64 overflow-y-auto p-1.5">
              {filteredOptions.length === 0 ? (
                <p className="px-2 py-3 text-xs font-semibold text-muted-foreground">
                  {emptyText}
                </p>
              ) : (
                filteredOptions.map((option, index) => {
                  const selected = optionMatchesValue(option.value, value);
                  const active =
                    activeOption &&
                    optionMatchesValue(option.value, activeOption.value);
                  const showGroup =
                    Boolean(option.group) &&
                    filteredOptions[index - 1]?.group !== option.group;

                  return (
                    <Fragment key={optionKey(option.value)}>
                      {showGroup && (
                        <p className="px-2.5 pb-1 pt-2 text-xs font-bold text-muted-foreground first:pt-1">
                          {option.group}
                        </p>
                      )}
                      <button
                        aria-selected={selected}
                        className={joinClasses(
                          "flex w-full items-start justify-between gap-3 rounded-lg px-2.5 py-2 text-right text-sm font-semibold transition",
                          selected
                            ? "bg-primary/10 text-foreground"
                            : active
                              ? "bg-muted text-foreground"
                              : "hover:bg-muted",
                          option.disabled &&
                            "cursor-not-allowed opacity-50 hover:bg-transparent",
                        )}
                        disabled={option.disabled}
                        onClick={() => selectOption(option)}
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
                        {selected && (
                          <span className="grid h-5 w-5 shrink-0 place-items-center rounded-md border border-primary bg-primary text-xs font-bold text-primary-foreground">
                            ✓
                          </span>
                        )}
                      </button>
                    </Fragment>
                  );
                })
              )}
            </div>
          </div>
        )}
      </div>

      <KoochFieldMessage error={error} helperText={helperText} id={messageId} />
    </div>
  );
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
  id,
  "aria-describedby": ariaDescribedBy,
  "aria-invalid": ariaInvalid,
}: KoochMultiSelectProps) {
  const generatedId = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const controlId = id ?? `kooch-multi-select-${generatedId}`;
  const messageId = error || helperText ? `${controlId}-message` : undefined;

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
          aria-describedby={mergeAriaIds(ariaDescribedBy, messageId)}
          aria-expanded={open}
          aria-invalid={resolveAriaInvalid(error, ariaInvalid)}
          className={joinClasses(
            "kooch-form-control flex min-h-10 w-full items-center justify-between gap-2 px-3 py-2 text-right text-sm transition disabled:opacity-50",
            className,
          )}
          data-control-active={open ? "true" : undefined}
          disabled={disabled}
          id={controlId}
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
                          "grid h-5 w-5 shrink-0 place-items-center rounded-md border text-xs font-bold transition",
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

      <KoochFieldMessage error={error} helperText={helperText} id={messageId} />
    </div>
  );
}
