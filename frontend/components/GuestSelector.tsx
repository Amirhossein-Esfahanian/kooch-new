"use client";

import { useEffect, useRef, useState } from "react";

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
  className?: string;
  controlClassName?: string;
  maxChildren?: number;
}

function formatFaNumber(value: number) {
  return new Intl.NumberFormat("fa-IR").format(value);
}

function clamp(value: number, min: number, max?: number) {
  if (typeof max === "number") return Math.max(min, Math.min(max, value));
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

  return (
    <div className="flex items-center justify-between gap-4 py-3">
      <div>
        <p className="font-black text-slate-950">{title}</p>
        {subtitle && <p className="mt-1 text-xs font-bold text-slate-500">{subtitle}</p>}
      </div>
      <div className="flex items-center gap-3" dir="ltr">
        <button
          className="grid h-8 w-8 place-items-center rounded-full border border-slate-300 text-lg font-black text-[var(--theme-primary)] transition hover:border-[var(--theme-primary)] disabled:cursor-not-allowed disabled:text-slate-300"
          disabled={!canDecrease}
          onClick={() => onChange(value - 1)}
          type="button"
        >
          -
        </button>
        <span className="w-7 text-center text-xl font-black text-slate-950">{formatFaNumber(value)}</span>
        <button
          className="grid h-8 w-8 place-items-center rounded-full border border-slate-300 text-lg font-black text-[var(--theme-primary)] transition hover:border-[var(--theme-primary)] disabled:cursor-not-allowed disabled:text-slate-300"
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
  className = "",
  controlClassName = "h-[60px] w-full rounded-xl border border-slate-300 bg-white px-4 text-sm font-bold text-slate-900 outline-none transition focus:border-[var(--theme-primary)] focus:ring-2 focus:ring-[var(--theme-primary-border)]",
  maxChildren = 6,
}: GuestSelectorProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    function onPointerDown(event: PointerEvent) {
      if (!wrapperRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, []);

  function update(next: Partial<GuestSelectorValue>) {
    const nextRooms = clamp(next.rooms ?? value.rooms, 1);
    const nextAdults = clamp(next.adults ?? value.adults, 1);
    const nextChildren = clamp(next.children ?? value.children, 0, maxChildren);
    const nextAges = (next.childAges ?? value.childAges).slice(0, nextChildren);
    while (nextAges.length < nextChildren) nextAges.push(5);
    onChange({
      rooms: nextRooms,
      adults: nextAdults,
      children: nextChildren,
      childAges: nextAges,
    });
  }

  const guestSummary = `${formatFaNumber(value.adults)} بزرگسال، ${formatFaNumber(value.children)} کودک`;
  const roomSummary = `${formatFaNumber(value.rooms)} اتاق`;

  return (
    <div className={`relative grid gap-2 text-sm font-bold text-slate-700 ${className}`} ref={wrapperRef}>
      {label}
      <button
        className={`${controlClassName} flex items-center justify-between gap-4 text-right`}
        onClick={() => setOpen((current) => !current)}
        type="button"
      >
        <span className="grid min-w-0 gap-1">
          <span className="truncate">{guestSummary}</span>
          <span className="text-xs font-bold text-slate-500">{roomSummary}</span>
        </span>
        <span className={`text-lg text-slate-500 transition ${open ? "rotate-180" : ""}`}>⌄</span>
      </button>

      {open && (
        <div className="absolute right-0 top-full z-40 mt-3 w-full rounded-2xl border border-slate-200 bg-white p-5 text-right shadow-2xl sm:w-[360px]">
          <CounterRow title="تعداد اتاق" value={value.rooms} min={1} onChange={(rooms) => update({ rooms })} />
          <CounterRow title="بزرگسال" subtitle="۱۸ سال به بالا" value={value.adults} min={1} onChange={(adults) => update({ adults })} />
          <CounterRow title="کودک" subtitle="۰ تا ۱۷ سال" value={value.children} min={0} max={maxChildren} onChange={(children) => update({ children })} />

          {value.children > 0 && (
            <div className="mt-4 border-t border-slate-100 pt-4">
              <p className="mb-3 text-sm leading-6 text-slate-600">برای محاسبه دقیق، سن کودک را وارد کنید.</p>
              <div className="grid gap-3">
                {value.childAges.map((age, index) => (
                  <label className="grid gap-2 text-sm font-bold text-slate-700" key={index}>
                    سن کودک {formatFaNumber(index + 1)}
                    <select
                      className="h-11 rounded-xl border border-slate-300 bg-white px-3 text-sm font-bold outline-none focus:border-[var(--theme-primary)] focus:ring-2 focus:ring-[var(--theme-primary-border)]"
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
