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

function joinClasses(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

const controlBaseClass =
  "w-full rounded-lg border border-border bg-background text-foreground outline-none transition placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-60 focus:border-ring focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-background aria-[invalid=true]:border-destructive aria-[invalid=true]:focus:ring-destructive";

export type KoochInputProps = InputHTMLAttributes<HTMLInputElement> &
  FieldStateProps & {
    className?: string;
  };

export function KoochInput({
  className = "",
  error,
  helperText,
  ...props
}: KoochInputProps) {
  return (
    <div className="grid gap-1.5">
      <input
        aria-invalid={Boolean(error) || undefined}
        className={joinClasses(
          "min-h-10 px-3 py-2 text-sm",
          controlBaseClass,
          className,
        )}
        {...props}
      />
      <KoochFieldMessage error={error} helperText={helperText} />
    </div>
  );
}

export type KoochSelectProps = SelectHTMLAttributes<HTMLSelectElement> &
  FieldStateProps & {
    className?: string;
  };

export function KoochSelect({
  children,
  className = "",
  error,
  helperText,
  ...props
}: KoochSelectProps) {
  return (
    <div className="grid gap-1.5">
      <select
        aria-invalid={Boolean(error) || undefined}
        className={joinClasses(
          "min-h-10 px-3 py-2 text-sm",
          controlBaseClass,
          className,
        )}
        {...props}
      >
        {children}
      </select>
      <KoochFieldMessage error={error} helperText={helperText} />
    </div>
  );
}

export type KoochTextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement> &
  FieldStateProps & {
    className?: string;
  };

export function KoochTextarea({
  className = "",
  error,
  helperText,
  rows = 4,
  ...props
}: KoochTextareaProps) {
  return (
    <div className="grid gap-1.5">
      <textarea
        aria-invalid={Boolean(error) || undefined}
        className={joinClasses(
          "min-h-28 px-3 py-2 text-sm",
          controlBaseClass,
          className,
        )}
        rows={rows}
        {...props}
      />
      <KoochFieldMessage error={error} helperText={helperText} />
    </div>
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
      className={joinClasses("text-sm font-bold text-foreground", className)}
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

function KoochFieldMessage({
  error,
  helperText,
}: FieldStateProps) {
  if (error) {
    return <p className="text-xs font-semibold text-destructive">{error}</p>;
  }

  if (helperText) {
    return (
      <p className="text-xs font-semibold text-muted-foreground">
        {helperText}
      </p>
    );
  }

  return null;
}
