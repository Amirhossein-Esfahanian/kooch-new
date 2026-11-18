"use client";

import { type ReactNode, useId } from "react";

const number = (value: number) => new Intl.NumberFormat("fa-IR").format(value);

export function GuestCounter({ title, subtitle, value, min, max, onChange, compact = false }: {
  title: string; subtitle?: string; value: number; min: number; max?: number;
  onChange: (value: number) => void; compact?: boolean;
}) {
  const titleId = useId();
  const subtitleId = useId();
  return <div aria-describedby={subtitle ? subtitleId : undefined} aria-labelledby={titleId}
    className={`flex items-center justify-between ${compact ? "gap-2 rounded-lg border border-border px-3 py-1" : "gap-4 py-3"}`} role="group">
    <div><p className="font-bold text-foreground" id={titleId}>{title}</p>
      {subtitle && <p className="mt-1 text-xs font-bold text-muted-foreground" id={subtitleId}>{subtitle}</p>}</div>
    <div className="flex items-center gap-3" dir="ltr">
      <button aria-label={`کاهش ${title}`} type="button" disabled={value <= min} onClick={() => onChange(value - 1)}
        className="touch-target-44 grid h-8 w-8 place-items-center rounded-full border border-border text-lg font-bold text-primary transition hover:border-primary disabled:cursor-not-allowed disabled:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">-</button>
      <output aria-atomic="true" aria-label={title} aria-live="polite" className="w-7 text-center text-xl font-bold text-foreground">{number(value)}</output>
      <button aria-label={`افزایش ${title}`} type="button" disabled={max !== undefined && value >= max} onClick={() => onChange(value + 1)}
        className="touch-target-44 grid h-8 w-8 place-items-center rounded-full border border-border text-lg font-bold text-primary transition hover:border-primary disabled:cursor-not-allowed disabled:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">+</button>
    </div>
  </div>;
}

export function GuestCountControls({ adults, childrenCount, childAges, onAdultsChange, onChildrenChange,
  onChildAgeChange, maxAdults, maxChildren, compact = false, requireChildAges = false, adultLabel = "بزرگسال", childLabel = "کودک", children, sections = "all" }: {
  adults: number; childrenCount: number; childAges: readonly (number | string)[];
  onAdultsChange: (value: number) => void; onChildrenChange: (value: number) => void;
  onChildAgeChange: (index: number, value: string) => void; maxAdults?: number; maxChildren?: number;
  compact?: boolean; requireChildAges?: boolean; adultLabel?: string; childLabel?: string; children?: ReactNode;
  sections?: "all" | "counts" | "ages";
}) {
  return <>
    {sections !== "ages" && <div className={compact ? `grid min-w-0 gap-3 ${sections === "counts" ? "" : "sm:grid-cols-2 xl:grid-cols-3"}` : undefined}>
      <GuestCounter title={adultLabel} subtitle={compact ? undefined : "۱۸ سال به بالا"} value={adults} min={1}
        max={maxAdults} onChange={onAdultsChange} compact={compact} />
      <GuestCounter title={childLabel} subtitle={compact ? undefined : "۰ تا ۱۷ سال"} value={childrenCount} min={0}
        max={maxChildren} onChange={onChildrenChange} compact={compact} />
      {children}
    </div>}
    {sections !== "counts" && childrenCount > 0 && <div className={compact ? "grid gap-2" : "mt-4 border-t border-border pt-4"}>
      <p className={compact ? "text-xs text-muted-foreground" : "mb-3 text-sm leading-6 text-muted-foreground"}>برای محاسبه دقیق، سن کودک را وارد کنید.</p>
      <div className={compact ? "grid gap-3 sm:grid-cols-2 lg:grid-cols-3" : "grid gap-3"}>
        {childAges.map((age, index) => <label className="grid gap-2 text-sm font-bold text-foreground" key={index}>
          سن کودک {number(index + 1)}
          <select className="kooch-form-control h-11 min-w-0 px-3 text-sm font-bold" required={requireChildAges}
            aria-invalid={requireChildAges && age === "" || undefined} value={age}
            onChange={event => onChildAgeChange(index, event.target.value)}>
            {requireChildAges && <option value="">انتخاب سن</option>}
            {Array.from({ length: 18 }, (_, value) => <option key={value} value={value}>{number(value)}</option>)}
          </select>
        </label>)}
      </div>
    </div>}
  </>;
}
