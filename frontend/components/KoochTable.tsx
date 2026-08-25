import type {
  HTMLAttributes,
  ReactNode,
  TableHTMLAttributes,
  TdHTMLAttributes,
  ThHTMLAttributes,
} from "react";

function joinClasses(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

export type KoochTableProps = TableHTMLAttributes<HTMLTableElement> & {
  className?: string;
};

export function KoochTable({ className = "", ...props }: KoochTableProps) {
  return (
    <div className="min-w-0 max-w-full overflow-x-auto rounded-lg border border-border bg-card text-card-foreground">
      <table
        className={joinClasses(
          "w-full min-w-[900px] border-collapse text-right text-sm",
          className,
        )}
        dir="rtl"
        {...props}
      />
    </div>
  );
}

export type KoochTableHeaderProps = HTMLAttributes<HTMLTableSectionElement> & {
  className?: string;
};

export function KoochTableHeader({
  className = "",
  ...props
}: KoochTableHeaderProps) {
  return (
    <thead
      className={joinClasses(
        "border-b border-border bg-muted text-xs font-bold text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}

export type KoochTableBodyProps = HTMLAttributes<HTMLTableSectionElement> & {
  className?: string;
};

export function KoochTableBody({
  className = "",
  ...props
}: KoochTableBodyProps) {
  return (
    <tbody
      className={joinClasses("divide-y divide-border", className)}
      {...props}
    />
  );
}

export type KoochTableRowProps = HTMLAttributes<HTMLTableRowElement> & {
  className?: string;
};

export function KoochTableRow({
  className = "",
  ...props
}: KoochTableRowProps) {
  return (
    <tr
      className={joinClasses("transition-colors hover:bg-muted/70", className)}
      {...props}
    />
  );
}

export type KoochTableHeadProps = ThHTMLAttributes<HTMLTableCellElement> & {
  className?: string;
};

export function KoochTableHead({
  className = "",
  ...props
}: KoochTableHeadProps) {
  return (
    <th
      className={joinClasses(
        "whitespace-nowrap px-4 py-3 text-right align-middle",
        className,
      )}
      scope="col"
      {...props}
    />
  );
}

export type KoochTableCellProps = TdHTMLAttributes<HTMLTableCellElement> & {
  className?: string;
};

export function KoochTableCell({
  className = "",
  ...props
}: KoochTableCellProps) {
  return (
    <td
      className={joinClasses(
        "px-4 py-3 align-middle text-foreground",
        className,
      )}
      {...props}
    />
  );
}

export type KoochTableEmptyProps = HTMLAttributes<HTMLTableRowElement> & {
  children: ReactNode;
  className?: string;
  colSpan?: number;
};

export function KoochTableEmpty({
  children,
  className = "",
  colSpan = 1,
  ...props
}: KoochTableEmptyProps) {
  return (
    <tr className={className} {...props}>
      <td
        className="px-4 py-8 text-center text-sm font-medium text-muted-foreground"
        colSpan={colSpan}
      >
        {children}
      </td>
    </tr>
  );
}
