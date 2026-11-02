"use client";

import { ReactNode, useEffect, useId, useRef, useState } from "react";

export type GuestSelectorValue = {
  rooms: number;
  adults: number;
  children: number;
  childAges: number[];
};

export interface GuestSelectorProps {
  value: GuestSelectorValue;
  onChange: (value: GuestSelectorValue) => void;
  label?: string;
  icon?: ReactNode;
  className?: string;
  controlClassName?: string;
  maxChildren?: number;
}

function formatFaNumber(value: number) {
  return new Intl.NumberFormat("fa-IR").format(value);
}

function clamp(value: number, min: number, max?: number) {
  if (typeof max === "number") {
    return Math.max(min, Math.min(max, value));
  }

  return Math.max(min, value);
}

function CounterRow({
  title,
  subtitle,
  value,
  min,
  max,
  onChange,
}: {
  title: string;
  subtitle?: string;
  value: number;
  min: number;
  max?: number;
  onChange: (value: number) => void;
}) {
  const canDecrease = value > min;
  const canIncrease = max === undefined || value < max;
  const titleId = useId();
  const subtitleId = useId();

  return (
    <div aria-describedby={subtitle ? subtitleId : undefined} aria-labelledby={titleId} className="flex items-center justify-between gap-4 py-3" role="group">
      <div>
        <p className="font-bold text-foreground" id={titleId}>{title}</p>

        {subtitle && (
          <p className="mt-1 text-xs font-bold text-muted-foreground" id={subtitleId}>{subtitle}</p>
        )}
      </div>

      <div className="flex items-center gap-3" dir="ltr">
        <button
          aria-label={`کاهش ${title}`}
          className="touch-target-44 grid h-8 w-8 place-items-center rounded-full border border-border text-lg font-bold text-primary transition hover:border-primary disabled:cursor-not-allowed disabled:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          disabled={!canDecrease}
          onClick={() => onChange(value - 1)}
          type="button"
        >
          -
        </button>

        <output aria-atomic="true" aria-label={title} aria-live="polite" className="w-7 text-center text-xl font-bold text-foreground">
          {formatFaNumber(value)}
        </output>

        <button
          aria-label={`افزایش ${title}`}
          className="touch-target-44 grid h-8 w-8 place-items-center rounded-full border border-border text-lg font-bold text-primary transition hover:border-primary disabled:cursor-not-allowed disabled:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          disabled={!canIncrease}
          onClick={() => onChange(value + 1)}
          type="button"
        >
          +
        </button>
      </div>
    </div>
  );
}

export function GuestSelector({
  value,
  onChange,
  label = "مسافران",
  icon,
  className = "",
  controlClassName = "h-[60px] w-full px-4 text-sm font-bold transition",
  maxChildren = 6,
}: GuestSelectorProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverId = useId();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    function onPointerDown(event: PointerEvent) {
      if (!wrapperRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    document.addEventListener("pointerdown", onPointerDown);

    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, []);

  function update(next: Partial<GuestSelectorValue>) {
    const nextRooms = clamp(next.rooms ?? value.rooms, 1);
    const nextAdults = clamp(next.adults ?? value.adults, 1);
    const nextChildren = clamp(next.children ?? value.children, 0, maxChildren);

    const nextAges = (next.childAges ?? value.childAges).slice(0, nextChildren);

    while (nextAges.length < nextChildren) {
      nextAges.push(5);
    }

    onChange({
      rooms: nextRooms,
      adults: nextAdults,
      children: nextChildren,
      childAges: nextAges,
    });
  }

  const guestSummary =
    `${formatFaNumber(value.adults)} بزرگسال، ` +
    `${formatFaNumber(value.children)} کودک`;

  const roomSummary = `${formatFaNumber(value.rooms)} اتاق`;

  return (
    <div
      className={`relative grid gap-2 text-sm font-bold text-foreground ${className}`}
      onKeyDown={(event) => {
        if (!open || event.key !== "Escape") return;
        event.preventDefault();
        event.stopPropagation();
        setOpen(false);
        triggerRef.current?.focus();
      }}
      ref={wrapperRef}
    >
      {label && <span>{label}</span>}

      <button
        aria-controls={open ? popoverId : undefined}
        aria-expanded={open}
        aria-label={`${label || "مسافران"}: ${guestSummary}، ${roomSummary}`}
        className={`kooch-form-control ${controlClassName} flex items-center justify-between gap-3 text-right`}
        data-control-active={open ? "true" : undefined}
        onClick={() => setOpen((current) => !current)}
        ref={triggerRef}
        type="button"
      >
        <span className="flex min-w-0 items-center gap-2.5">
          {icon && (
            <span className="flex shrink-0 items-center justify-center">
              {icon}
            </span>
          )}

          <span className="grid min-w-0 gap-1">
            <span className="truncate">{guestSummary}</span>

            <span className="truncate text-xs font-bold text-muted-foreground">
              {roomSummary}
            </span>
          </span>
        </span>

        <span
          aria-hidden="true"
          className={`shrink-0 text-lg text-muted-foreground transition motion-reduce:transition-none ${
            open ? "rotate-180" : ""
          }`}
        >
          ⌄
        </span>
      </button>

      {open && (
        <div aria-label="انتخاب مسافران و اتاق‌ها" className="absolute end-0 top-full z-40 mt-3 w-full rounded-2xl border border-border bg-popover p-5 text-right text-popover-foreground shadow-2xl sm:w-[360px]" dir="rtl" id={popoverId} role="group">
          <CounterRow
            title="تعداد اتاق"
            value={value.rooms}
            min={1}
            onChange={(rooms) => update({ rooms })}
          />

          <CounterRow
            title="بزرگسال"
            subtitle="۱۸ سال به بالا"
            value={value.adults}
            min={1}
            onChange={(adults) => update({ adults })}
          />

          <CounterRow
            title="کودک"
            subtitle="۰ تا ۱۷ سال"
            value={value.children}
            min={0}
            max={maxChildren}
            onChange={(children) => update({ children })}
          />

          {value.children > 0 && (
            <div className="mt-4 border-t border-border pt-4">
              <p className="mb-3 text-sm leading-6 text-muted-foreground">
                برای محاسبه دقیق، سن کودک را وارد کنید.
              </p>

              <div className="grid gap-3">
                {value.childAges.map((age, index) => (
                  <label
                    className="grid gap-2 text-sm font-bold text-foreground"
                    key={index}
                  >
                    سن کودک {formatFaNumber(index + 1)}
                    <select
                      className="kooch-form-control h-11 px-3 text-sm font-bold"
                      onChange={(event) => {
                        const childAges = [...value.childAges];
                        childAges[index] = Number(event.target.value);

                        update({ childAges });
                      }}
                      value={age}
                    >
                      {Array.from({ length: 18 }, (_, optionAge) => (
                        <option key={optionAge} value={optionAge}>
                          {formatFaNumber(optionAge)}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
