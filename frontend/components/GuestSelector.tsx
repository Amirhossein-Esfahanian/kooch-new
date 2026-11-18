"use client";

import { ReactNode, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { GuestCounter, GuestCountControls } from "./GuestCountControls";

export type GuestSelectorValue<Age extends number | string = number> = {
  rooms: number;
  adults: number;
  children: number;
  childAges: Age[];
};

export interface GuestSelectorProps<Age extends number | string = number> {
  value: GuestSelectorValue<Age>;
  onChange: (value: GuestSelectorValue<Age>) => void;
  label?: string;
  icon?: ReactNode;
  className?: string;
  controlClassName?: string;
  maxChildren?: number;
  maxRooms?: number;
  maxAdults?: number;
  defaultChildAge?: Age;
  requireChildAges?: boolean;
  childAgesOutside?: boolean;
  /** Use the browser top layer inside scrollable dialogs without moving the form. */
  floating?: boolean;
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

export function GuestSelector<Age extends number | string = number>({
  value,
  onChange,
  label = "مسافران",
  icon,
  className = "",
  controlClassName = "h-[60px] w-full px-4 text-sm font-bold transition",
  maxChildren = 6,
  maxRooms,
  maxAdults,
  defaultChildAge = 5 as Age,
  requireChildAges = false,
  childAgesOutside = false,
  floating = false,
}: GuestSelectorProps<Age>) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverId = useId();
  const popoverRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ top: number; left: number; maxHeight: number } | null>(null);
  const [open, setOpen] = useState(false);

  useLayoutEffect(() => {
    if (!open || !floating) return;
    const popup = popoverRef.current;
    const trigger = triggerRef.current;
    if (!popup || !trigger) return;
    popup.showPopover?.();
    const updatePosition = () => {
      const rect = trigger.getBoundingClientRect();
      const margin = 16;
      const gap = 12;
      const below = window.innerHeight - rect.bottom - gap - margin;
      const above = rect.top - gap - margin;
      const height = Math.min(popup.scrollHeight, window.innerHeight - margin * 2);
      const placeBelow = below >= height || below >= above;
      const maxHeight = Math.max(44, placeBelow ? below : above);
      const left = Math.max(margin, Math.min(rect.right - popup.getBoundingClientRect().width,
        window.innerWidth - popup.getBoundingClientRect().width - margin));
      const top = placeBelow ? rect.bottom + gap : Math.max(margin, rect.top - gap - Math.min(height, maxHeight));
      setPosition({ top, left, maxHeight });
    };
    updatePosition();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(updatePosition);
    observer?.observe(popup);
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      observer?.disconnect();
      if (popup.isConnected) popup.hidePopover?.();
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [open, floating]);

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

  function update(next: Partial<GuestSelectorValue<Age>>) {
    const nextRooms = clamp(next.rooms ?? value.rooms, 1, maxRooms);
    const nextAdults = clamp(next.adults ?? value.adults, 1, maxAdults);
    const nextChildren = clamp(next.children ?? value.children, 0, maxChildren);

    const nextAges = (next.childAges ?? value.childAges).slice(0, nextChildren);

    while (nextAges.length < nextChildren) {
      nextAges.push(defaultChildAge);
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
        onClick={() => { setPosition(null); setOpen((current) => !current); }}
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
        <div aria-label="انتخاب مسافران و اتاق‌ها" ref={popoverRef} popover={floating ? "manual" : undefined}
          className={`${floating ? "fixed z-[80] m-0 w-[360px] max-w-[calc(100vw-2rem)] overflow-y-auto overscroll-contain" : "absolute end-0 top-full z-40 mt-3 w-full sm:w-[360px]"} rounded-2xl border border-border bg-popover p-5 text-right text-popover-foreground shadow-2xl`}
          style={floating ? { inset: "auto", top: position?.top ?? 0, left: position?.left ?? 0,
            maxHeight: position?.maxHeight, visibility: position ? "visible" : "hidden" } : undefined}
          dir="rtl" id={popoverId} role="group">
          <GuestCounter
            title="تعداد اتاق"
            value={value.rooms}
            min={1}
            max={maxRooms}
            onChange={(rooms) => update({ rooms })}
          />

          <GuestCountControls adults={value.adults} childrenCount={value.children} childAges={value.childAges}
            requireChildAges={requireChildAges}
            sections={childAgesOutside ? "counts" : "all"} maxAdults={maxAdults}
            maxChildren={maxChildren} onAdultsChange={adults => update({ adults })}
            onChildrenChange={children => update({ children })}
            onChildAgeChange={(index, age) => {
              const childAges = [...value.childAges];
              childAges[index] = (typeof defaultChildAge === "string" ? age : Number(age)) as Age;
              update({ childAges });
            }} />
        </div>
      )}
      {childAgesOutside && <GuestCountControls compact sections="ages" requireChildAges={requireChildAges}
        adults={value.adults} childrenCount={value.children} childAges={value.childAges}
        onAdultsChange={adults => update({ adults })} onChildrenChange={children => update({ children })}
        onChildAgeChange={(index, age) => {
          const childAges = [...value.childAges];
          childAges[index] = (typeof defaultChildAge === "string" ? age : Number(age)) as Age;
          update({ childAges });
        }} />}
    </div>
  );
}
