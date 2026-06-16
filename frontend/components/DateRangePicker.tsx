"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import dayjs, { Dayjs } from "dayjs";
import jalaliday from "jalaliday/dayjs";
import "dayjs/locale/fa";

dayjs.extend(jalaliday);

export type DateRangeValue = {
  startDate: string | null;
  endDate: string | null;
};

type CalendarType = "jalali" | "gregorian";
type ActiveField = "startDate" | "endDate";

interface DateRangePickerProps {
  value: DateRangeValue;
  onChange: (value: DateRangeValue) => void;
  calendarType: CalendarType;
  disablePastDates?: boolean;
  placeholderStart?: string;
  placeholderEnd?: string;
}

const jalaliMonths = [
  "فروردین",
  "اردیبهشت",
  "خرداد",
  "تیر",
  "مرداد",
  "شهریور",
  "مهر",
  "آبان",
  "آذر",
  "دی",
  "بهمن",
  "اسفند",
];

const gregorianMonths = [
  "ژانویه",
  "فوریه",
  "مارس",
  "آوریل",
  "مه",
  "ژوئن",
  "ژوئیه",
  "اوت",
  "سپتامبر",
  "اکتبر",
  "نوامبر",
  "دسامبر",
];

const weekdayLabels = ["ش", "ی", "د", "س", "چ", "پ", "ج"];
const isoFormat = "YYYY-MM-DD";

function calendarName(calendarType: CalendarType) {
  return calendarType === "jalali" ? "jalali" : "gregory";
}

function asCalendar(date: Dayjs, calendarType: CalendarType) {
  return date.calendar(calendarName(calendarType)).locale(calendarType === "jalali" ? "fa" : "en");
}

function displayDate(isoDate: string | null, calendarType: CalendarType, placeholder: string) {
  if (!isoDate) return placeholder;
  return asCalendar(dayjs(isoDate), calendarType).format(calendarType === "jalali" ? "YYYY/MM/DD" : "YYYY-MM-DD");
}

function toIso(date: Dayjs) {
  return date.calendar("gregory").format(isoFormat);
}

function monthTitle(month: Dayjs, calendarType: CalendarType) {
  const view = asCalendar(month, calendarType);
  const monthIndex = view.month();
  const monthName = calendarType === "jalali" ? jalaliMonths[monthIndex] : gregorianMonths[monthIndex];
  return `${monthName} ${view.format("YYYY")}`;
}

function isPast(date: Dayjs) {
  return date.calendar("gregory").startOf("day").isBefore(dayjs().startOf("day"));
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

function firstWeekdayOffset(month: Dayjs, calendarType: CalendarType) {
  const day = asCalendar(month, calendarType).startOf("month").calendar("gregory").day();
  return (day + 1) % 7;
}

function buildMonthDays(month: Dayjs, calendarType: CalendarType) {
  const calendarMonth = asCalendar(month, calendarType).startOf("month");
  const days: (Dayjs | null)[] = Array.from({ length: firstWeekdayOffset(month, calendarType) }, () => null);
  for (let day = 0; day < calendarMonth.daysInMonth(); day += 1) {
    days.push(calendarMonth.add(day, "day"));
  }
  while (days.length % 7 !== 0) days.push(null);
  return days;
}

export function DateRangePicker({
  value,
  onChange,
  calendarType,
  disablePastDates = false,
  placeholderStart = "تاریخ رفت",
  placeholderEnd = "تاریخ برگشت",
}: DateRangePickerProps) {
  const [activeCalendar, setActiveCalendar] = useState<CalendarType>(calendarType);
  const [activeField, setActiveField] = useState<ActiveField | null>(null);
  const [tempStartDate, setTempStartDate] = useState<string | null>(value.startDate);
  const [tempEndDate, setTempEndDate] = useState<string | null>(value.endDate);
  const [visibleMonth, setVisibleMonth] = useState(() => asCalendar(dayjs(), calendarType).startOf("month"));
  const wrapperRef = useRef<HTMLDivElement>(null);
  const isOpen = activeField !== null;

  useEffect(() => {
    setActiveCalendar(calendarType);
    setVisibleMonth(asCalendar(dayjs(), calendarType).startOf("month"));
  }, [calendarType]);

  useEffect(() => {
    function onPointerDown(event: PointerEvent) {
      if (!wrapperRef.current?.contains(event.target as Node)) {
        setActiveField(null);
      }
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, []);

  const months = useMemo(
    () => [visibleMonth, asCalendar(visibleMonth, activeCalendar).add(1, "month")],
    [activeCalendar, visibleMonth],
  );

  function open(field: ActiveField) {
    setActiveField(field);
    setTempStartDate(value.startDate);
    setTempEndDate(value.endDate);
    setVisibleMonth(asCalendar(value.startDate ? dayjs(value.startDate) : dayjs(), activeCalendar).startOf("month"));
  }

  function selectDay(date: Dayjs) {
    if (disablePastDates && isPast(date)) return;
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

  function confirm() {
    if (!tempStartDate || !tempEndDate) return;
    onChange({ startDate: tempStartDate, endDate: tempEndDate });
    setActiveField(null);
  }

  function goToToday() {
    const today = dayjs();
    setVisibleMonth(asCalendar(today, activeCalendar).startOf("month"));
  }

  function moveMonth(direction: -1 | 1) {
    setVisibleMonth((current) => asCalendar(current, activeCalendar).add(direction, "month").startOf("month"));
  }

  function toggleCalendar() {
    const nextCalendar = activeCalendar === "jalali" ? "gregorian" : "jalali";
    setActiveCalendar(nextCalendar);
    setVisibleMonth(asCalendar(tempStartDate ? dayjs(tempStartDate) : visibleMonth, nextCalendar).startOf("month"));
  }

  return (
    <div className="relative" ref={wrapperRef} dir="rtl">
      <div className="grid gap-3 sm:grid-cols-2">
        <button className={`grid rounded-xl border bg-white px-4 py-3 text-right transition ${activeField === "startDate" ? "border-blue-500 ring-2 ring-blue-100" : "border-slate-300 hover:border-blue-300"}`} onClick={() => open("startDate")} type="button">
          <span className="text-xs font-bold text-slate-500">تاریخ رفت</span>
          <span className={`mt-1 font-bold ${value.startDate ? "text-slate-950" : "text-slate-400"}`}>{displayDate(value.startDate, activeCalendar, placeholderStart)}</span>
        </button>
        <button className={`grid rounded-xl border bg-white px-4 py-3 text-right transition ${activeField === "endDate" ? "border-blue-500 ring-2 ring-blue-100" : "border-slate-300 hover:border-blue-300"}`} onClick={() => open("endDate")} type="button">
          <span className="text-xs font-bold text-slate-500">تاریخ برگشت</span>
          <span className={`mt-1 font-bold ${value.endDate ? "text-slate-950" : "text-slate-400"}`}>{displayDate(value.endDate, activeCalendar, placeholderEnd)}</span>
        </button>
      </div>

      {isOpen && (
        <div className="absolute right-0 top-full z-50 mt-3 w-full min-w-[min(92vw,360px)] rounded-2xl border border-slate-200 bg-white p-4 shadow-2xl sm:w-[680px]">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs font-bold text-slate-400">مبدا · مقصد</p>
              <p className="mt-1 text-sm font-bold text-slate-700">{activeField === "startDate" ? "انتخاب تاریخ رفت" : "انتخاب تاریخ برگشت"}</p>
            </div>
            <button className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-bold text-slate-700 hover:border-blue-300 hover:text-blue-700" onClick={toggleCalendar} type="button">
              {activeCalendar === "jalali" ? "تقویم میلادی" : "تقویم شمسی"}
            </button>
          </div>

          <div className="mb-4 flex items-center justify-between" dir="rtl">
            <button aria-label="ماه قبل" className="grid h-9 w-9 place-items-center rounded-full border border-slate-200 text-lg font-bold text-slate-700 hover:border-blue-300 hover:text-blue-700" onClick={() => moveMonth(-1)} type="button">›</button>
            <button aria-label="ماه بعد" className="grid h-9 w-9 place-items-center rounded-full border border-slate-200 text-lg font-bold text-slate-700 hover:border-blue-300 hover:text-blue-700" onClick={() => moveMonth(1)} type="button">‹</button>
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
                    const disabled = disablePastDates && isPast(date);
                    const isRangeStart = tempStartDate === iso;
                    const isRangeEnd = tempEndDate === iso;
                    const inRange = isBetween(iso, tempStartDate, tempEndDate);
                    const selected = isRangeStart || isRangeEnd;
                    const today = iso === dayjs().format(isoFormat);
                    return (
                      <div className={`h-10 ${inRange || selected ? "bg-blue-50" : ""} ${isRangeStart ? "rounded-r-full" : ""} ${isRangeEnd ? "rounded-l-full" : ""}`} key={iso}>
                        <button
                          className={`h-10 w-full text-sm font-bold transition ${selected ? "rounded-full bg-blue-600 text-white" : inRange ? "text-blue-700" : today ? "rounded-full border border-blue-500 text-blue-700" : "rounded-full text-slate-700 hover:bg-blue-50"} ${disabled ? "cursor-not-allowed text-slate-300 hover:bg-transparent" : ""}`}
                          disabled={disabled}
                          onClick={() => selectDay(date)}
                          type="button"
                        >
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
            <button className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-bold text-slate-700 hover:border-blue-300 hover:text-blue-700" onClick={goToToday} type="button">برو به امروز</button>
            <button className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-black text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50" disabled={!tempStartDate || !tempEndDate} onClick={confirm} type="button">تایید</button>
          </div>
        </div>
      )}
    </div>
  );
}
