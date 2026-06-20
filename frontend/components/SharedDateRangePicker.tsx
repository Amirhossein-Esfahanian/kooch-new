"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import dayjs, { Dayjs } from "dayjs";
import jalaliday from "jalaliday/dayjs";
import "dayjs/locale/fa";

dayjs.extend(jalaliday);

export type CalendarType = "jalali" | "gregorian";

export type SharedDateRangeValue = {
  startDate: string | null;
  endDate: string | null;
};

export interface SharedDateLabels {
  start?: string;
  end?: string;
  today?: string;
  gregorian?: string;
  jalali?: string;
  rangeTitle?: string;
}

export interface SharedDateRangePickerProps {
  /** Confirmed value. Dates must be Gregorian ISO strings: YYYY-MM-DD. */
  value: SharedDateRangeValue;
  /** Called only after confirm; returns Gregorian ISO strings. */
  onChange: (value: SharedDateRangeValue) => void;
  /** Initial calendar type. Jalali is the default. */
  calendarType?: CalendarType;
  /** Disable days before today. */
  disablePastDates?: boolean;
  /** Minimum selectable Gregorian ISO date. */
  minDate?: string;
  /** Maximum selectable Gregorian ISO date. */
  maxDate?: string;
  /** Placeholder for start input. */
  placeholderStart?: string;
  /** Placeholder for end input. */
  placeholderEnd?: string;
  /** Persian label overrides. */
  labels?: SharedDateLabels;
  /** Confirm button text. */
  confirmText?: string;
  /** Cancel button text. */
  cancelText?: string;
  /** Show Jalali/Gregorian toggle. */
  showGregorianToggle?: boolean;
  /** Use labels above fields. */
  labelsAbove?: boolean;
  /** Hide labels inside field buttons. */
  showFieldLabels?: boolean;
  /** Extra classes for field buttons. */
  controlClassName?: string;
}

type ActiveField = "startDate" | "endDate";

const jalaliMonths = ["فروردین", "اردیبهشت", "خرداد", "تیر", "مرداد", "شهریور", "مهر", "آبان", "آذر", "دی", "بهمن", "اسفند"];
const gregorianMonths = ["ژانویه", "فوریه", "مارس", "آوریل", "مه", "ژوئن", "ژوئیه", "اوت", "سپتامبر", "اکتبر", "نوامبر", "دسامبر"];
const weekdayLabels = ["ش", "ی", "د", "س", "چ", "پ", "ج"];
const isoFormat = "YYYY-MM-DD";

function calendarName(calendarType: CalendarType) {
  return calendarType === "jalali" ? "jalali" : "gregory";
}

function asCalendar(date: Dayjs, calendarType: CalendarType) {
  return date.calendar(calendarName(calendarType)).locale(calendarType === "jalali" ? "fa" : "en");
}

function toIso(date: Dayjs) {
  return date.calendar("gregory").format(isoFormat);
}

function displayDate(isoDate: string | null, calendarType: CalendarType, placeholder: string) {
  if (!isoDate) return placeholder;
  return asCalendar(dayjs(isoDate), calendarType).format(calendarType === "jalali" ? "YYYY/MM/DD" : "YYYY-MM-DD");
}

function monthTitle(month: Dayjs, calendarType: CalendarType) {
  const view = asCalendar(month, calendarType);
  const monthName = calendarType === "jalali" ? jalaliMonths[view.month()] : gregorianMonths[view.month()];
  return `${monthName} ${view.format("YYYY")}`;
}

function firstWeekdayOffset(month: Dayjs, calendarType: CalendarType) {
  const day = asCalendar(month, calendarType).startOf("month").calendar("gregory").day();
  return (day + 1) % 7;
}

function buildMonthDays(month: Dayjs, calendarType: CalendarType) {
  const calendarMonth = asCalendar(month, calendarType).startOf("month");
  const days: (Dayjs | null)[] = Array.from({ length: firstWeekdayOffset(month, calendarType) }, () => null);
  for (let day = 0; day < calendarMonth.daysInMonth(); day += 1) days.push(calendarMonth.add(day, "day"));
  while (days.length % 7 !== 0) days.push(null);
  return days;
}

function isBefore(firstDate: string, secondDate: string) {
  return dayjs(firstDate).isBefore(dayjs(secondDate), "day");
}

function isAfter(firstDate: string, secondDate: string) {
  return dayjs(firstDate).isAfter(dayjs(secondDate), "day");
}

function isBetween(date: string, startDate: string | null, endDate: string | null) {
  if (!startDate || !endDate) return false;
  return isAfter(date, startDate) && isBefore(date, endDate);
}

function isDisabled(date: Dayjs, disablePastDates: boolean, minDate?: string, maxDate?: string) {
  const iso = toIso(date);
  if (disablePastDates && dayjs(iso).isBefore(dayjs().startOf("day"), "day")) return true;
  if (minDate && dayjs(iso).isBefore(dayjs(minDate), "day")) return true;
  if (maxDate && dayjs(iso).isAfter(dayjs(maxDate), "day")) return true;
  return false;
}

export function SharedDateRangePicker({
  value,
  onChange,
  calendarType = "jalali",
  disablePastDates = false,
  minDate,
  maxDate,
  placeholderStart = "انتخاب تاریخ",
  placeholderEnd = "انتخاب تاریخ",
  labels,
  confirmText = "تایید",
  cancelText = "انصراف",
  showGregorianToggle = true,
  labelsAbove = false,
  showFieldLabels = true,
  controlClassName,
}: SharedDateRangePickerProps) {
  const text = {
    start: labels?.start ?? "تاریخ رفت",
    end: labels?.end ?? "تاریخ برگشت",
    today: labels?.today ?? "برو به امروز",
    gregorian: labels?.gregorian ?? "تقویم میلادی",
    jalali: labels?.jalali ?? "تقویم شمسی",
    rangeTitle: labels?.rangeTitle ?? "انتخاب بازه سفر",
  };
  const [activeCalendar, setActiveCalendar] = useState<CalendarType>(calendarType);
  const [activeField, setActiveField] = useState<ActiveField | null>(null);
  const [tempStartDate, setTempStartDate] = useState<string | null>(value.startDate);
  const [tempEndDate, setTempEndDate] = useState<string | null>(value.endDate);
  const [visibleMonth, setVisibleMonth] = useState(() => asCalendar(dayjs(), calendarType).startOf("month"));
  const wrapperRef = useRef<HTMLDivElement>(null);
  const dateButtonBase = controlClassName ?? "grid rounded-xl border bg-white px-4 py-3 text-right transition";
  const isOpen = activeField !== null;

  useEffect(() => setActiveCalendar(calendarType), [calendarType]);
  useEffect(() => {
    function onPointerDown(event: PointerEvent) {
      if (!wrapperRef.current?.contains(event.target as Node)) setActiveField(null);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, []);

  const months = useMemo(() => [visibleMonth, asCalendar(visibleMonth, activeCalendar).add(1, "month")], [activeCalendar, visibleMonth]);

  function open(field: ActiveField) {
    setActiveField(field);
    setTempStartDate(value.startDate);
    setTempEndDate(value.endDate);
    setVisibleMonth(asCalendar(value.startDate ? dayjs(value.startDate) : dayjs(), activeCalendar).startOf("month"));
  }

  function selectDay(date: Dayjs) {
    if (isDisabled(date, disablePastDates, minDate, maxDate)) return;
    const iso = toIso(date);
    if (!tempStartDate || tempEndDate) {
      setTempStartDate(iso);
      setTempEndDate(null);
      return;
    }
    if (isBefore(iso, tempStartDate)) {
      setTempStartDate(iso);
      setTempEndDate(tempStartDate);
      return;
    }
    setTempEndDate(iso);
  }

  function renderDateButton(field: ActiveField, label: string, valueDate: string | null, placeholder: string) {
    const active = activeField === field;
    return (
      <div className="grid gap-2">
        {labelsAbove && <span className="text-sm font-bold text-slate-700">{label}</span>}
        <button className={`${dateButtonBase} ${active ? "border-blue-500 ring-2 ring-blue-100" : "border-slate-300 hover:border-blue-300"}`} onClick={() => open(field)} type="button">
          {showFieldLabels && !labelsAbove && <span className="text-xs font-bold text-slate-500">{label}</span>}
          <span className={`${showFieldLabels && !labelsAbove ? "mt-1" : ""} font-bold ${valueDate ? "text-slate-950" : "text-slate-400"}`}>{displayDate(valueDate, activeCalendar, placeholder)}</span>
        </button>
      </div>
    );
  }

  return (
    <div className="relative" ref={wrapperRef} dir="rtl">
      <div className="grid gap-3 sm:grid-cols-2">
        {renderDateButton("startDate", text.start, value.startDate, placeholderStart)}
        {renderDateButton("endDate", text.end, value.endDate, placeholderEnd)}
      </div>
      {isOpen && (
        <div className="absolute right-0 top-full z-50 mt-3 w-full min-w-[min(92vw,360px)] rounded-2xl border border-slate-200 bg-white p-4 shadow-2xl sm:w-[680px]">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs font-bold text-slate-400">مبدا · مقصد</p>
              <p className="mt-1 text-sm font-bold text-slate-700">{text.rangeTitle}</p>
            </div>
            {showGregorianToggle && (
              <button className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-bold text-slate-700 hover:border-blue-300 hover:text-blue-700" onClick={() => {
                const nextCalendar = activeCalendar === "jalali" ? "gregorian" : "jalali";
                setActiveCalendar(nextCalendar);
                setVisibleMonth(asCalendar(tempStartDate ? dayjs(tempStartDate) : visibleMonth, nextCalendar).startOf("month"));
              }} type="button">
                {activeCalendar === "jalali" ? text.gregorian : text.jalali}
              </button>
            )}
          </div>
          <div className="mb-4 flex items-center justify-between" dir="rtl">
            <button aria-label="ماه قبل" className="grid h-9 w-9 place-items-center rounded-full border border-slate-200 text-lg font-bold text-slate-700 hover:border-blue-300 hover:text-blue-700" onClick={() => setVisibleMonth((current) => asCalendar(current, activeCalendar).add(-1, "month").startOf("month"))} type="button">›</button>
            <button aria-label="ماه بعد" className="grid h-9 w-9 place-items-center rounded-full border border-slate-200 text-lg font-bold text-slate-700 hover:border-blue-300 hover:text-blue-700" onClick={() => setVisibleMonth((current) => asCalendar(current, activeCalendar).add(1, "month").startOf("month"))} type="button">‹</button>
          </div>
          <div className="grid gap-5 sm:grid-cols-2">
            {months.map((month, monthIndex) => (
              <section className={monthIndex === 1 ? "hidden sm:block" : ""} key={`${activeCalendar}-${month.format("YYYY-MM")}-${monthIndex}`}>
                <h3 className="mb-3 text-center text-base font-black text-slate-950">{monthTitle(month, activeCalendar)}</h3>
                <div className="grid grid-cols-7 gap-1 text-center text-xs font-bold text-slate-400">
                  {weekdayLabels.map((weekday) => <span className="py-1" key={weekday}>{weekday}</span>)}
                </div>
                <div className="mt-1 grid grid-cols-7 gap-1">
                  {buildMonthDays(month, activeCalendar).map((date, index) => {
                    if (!date) return <span className="h-10" key={`empty-${index}`} />;
                    const iso = toIso(date);
                    const disabled = isDisabled(date, disablePastDates, minDate, maxDate);
                    const isRangeStart = tempStartDate === iso;
                    const isRangeEnd = tempEndDate === iso;
                    const inRange = isBetween(iso, tempStartDate, tempEndDate);
                    const selected = isRangeStart || isRangeEnd;
                    const today = iso === dayjs().format(isoFormat);
                    return (
                      <div className={`h-10 ${inRange || selected ? "bg-blue-50" : ""} ${isRangeStart ? "rounded-r-full" : ""} ${isRangeEnd ? "rounded-l-full" : ""}`} key={iso}>
                        <button className={`h-10 w-full text-sm font-bold transition ${selected ? "rounded-full bg-blue-600 text-white" : inRange ? "text-blue-700" : today ? "rounded-full border border-blue-500 text-blue-700" : "rounded-full text-slate-700 hover:bg-blue-50"} ${disabled ? "cursor-not-allowed text-slate-300 hover:bg-transparent" : ""}`} disabled={disabled} onClick={() => selectDay(date)} type="button">
                          {asCalendar(date, activeCalendar).format("D")}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
          <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4">
            <button className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-bold text-slate-700 hover:border-blue-300 hover:text-blue-700" onClick={() => setVisibleMonth(asCalendar(dayjs(), activeCalendar).startOf("month"))} type="button">{text.today}</button>
            <div className="flex gap-2">
              <button className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-bold text-slate-700" onClick={() => setActiveField(null)} type="button">{cancelText}</button>
              <button className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-black text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50" disabled={!tempStartDate || !tempEndDate} onClick={() => {
                if (!tempStartDate || !tempEndDate) return;
                onChange({ startDate: tempStartDate, endDate: tempEndDate });
                setActiveField(null);
              }} type="button">{confirmText}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
