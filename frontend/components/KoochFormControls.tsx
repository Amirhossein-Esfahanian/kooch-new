import type {
  HTMLAttributes,
  InputHTMLAttributes,
  LabelHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
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
