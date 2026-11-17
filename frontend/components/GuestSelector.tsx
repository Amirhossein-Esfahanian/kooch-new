"use client";

import { ReactNode, useEffect, useId, useRef, useState } from "react";
import { GuestCounter, GuestCountControls } from "./GuestCountControls";

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
          <GuestCounter
            title="تعداد اتاق"
            value={value.rooms}
            min={1}
            onChange={(rooms) => update({ rooms })}
          />

          <GuestCountControls adults={value.adults} childrenCount={value.children} childAges={value.childAges}
            maxChildren={maxChildren} onAdultsChange={adults => update({ adults })}
            onChildrenChange={children => update({ children })}
            onChildAgeChange={(index, age) => {
              const childAges = [...value.childAges];
              childAges[index] = Number(age);
              update({ childAges });
            }} />
        </div>
      )}
    </div>
  );
}
