"use client";

import { useEffect, useRef, useState } from "react";
import dayjs, { Dayjs } from "dayjs";
import jalaliday from "jalaliday/dayjs";
import "dayjs/locale/fa";
import { CalendarType } from "@/components/SharedDateRangePicker";
import {
  HolidayCalendarDayContent,
  HolidayCalendarDetails,
  holidayAccessibleLabel,
  holidayDayStateClass,
  useHolidayCalendarDetails,
} from "@/components/HolidayCalendarDayContent";
import { useHolidayCalendarMonths } from "@/hooks/useHolidayCalendarMonths";

dayjs.extend(jalaliday);

export interface SharedSingleDateLabels {
  today?: string;
  gregorian?: string;
  jalali?: string;
  title?: string;
}

export interface SharedSingleDatePickerProps {
  /** Confirmed value as Gregorian ISO date: YYYY-MM-DD. */
  value: string | null;
  /** Called only after confirm; returns Gregorian ISO date. */
  onChange: (value: string | null) => void;
  /** Initial calendar type. Jalali is the default. */
  calendarType?: CalendarType;
  /** Disable days before today. */
  disablePastDates?: boolean;
  /** Minimum selectable Gregorian ISO date. */
  minDate?: string;
  /** Maximum selectable Gregorian ISO date. */
  maxDate?: string;
  /** Disabled Gregorian ISO dates or predicate. */
  disabledDates?: string[] | ((isoDate: string) => boolean);
  /** Placeholder shown when no date is selected. */
  placeholder?: string;
  /** Field label. */
  label?: string;
  /** Persian label overrides. */
  labels?: SharedSingleDateLabels;
  /** Confirm button text. */
  confirmText?: string;
  /** Cancel button text. */
  cancelText?: string;
  /** Show Jalali/Gregorian toggle. */
  showGregorianToggle?: boolean;
  /** Extra classes for field button. */
  controlClassName?: string;
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
  return date
    .calendar(calendarName(calendarType))
    .locale(calendarType === "jalali" ? "fa" : "en");
}

function toIso(date: Dayjs) {
  return date.calendar("gregory").format(isoFormat);
}

function displayDate(
  isoDate: string | null,
  calendarType: CalendarType,
  placeholder: string,
) {
  if (!isoDate) return placeholder;
  return asCalendar(dayjs(isoDate), calendarType).format(
    calendarType === "jalali" ? "YYYY/MM/DD" : "YYYY-MM-DD",
  );
}

function monthTitle(month: Dayjs, calendarType: CalendarType) {
  const view = asCalendar(month, calendarType);
  const monthName =
    calendarType === "jalali"
      ? jalaliMonths[view.month()]
      : gregorianMonths[view.month()];
  return `${monthName} ${view.format("YYYY")}`;
}

function firstWeekdayOffset(month: Dayjs, calendarType: CalendarType) {
  const day = asCalendar(month, calendarType)
    .startOf("month")
    .calendar("gregory")
    .day();
  return (day + 1) % 7;
}

function buildMonthDays(month: Dayjs, calendarType: CalendarType) {
  const calendarMonth = asCalendar(month, calendarType).startOf("month");
  const days: (Dayjs | null)[] = Array.from(
    { length: firstWeekdayOffset(month, calendarType) },
    () => null,
  );
  for (let day = 0; day < calendarMonth.daysInMonth(); day += 1)
    days.push(calendarMonth.add(day, "day"));
  while (days.length % 7 !== 0) days.push(null);
  return days;
}

function isDisabled(
  date: Dayjs,
  disablePastDates: boolean,
  minDate?: string,
  maxDate?: string,
  disabledDates?: string[] | ((isoDate: string) => boolean),
) {
  const iso = toIso(date);
  if (disablePastDates && dayjs(iso).isBefore(dayjs().startOf("day"), "day"))
    return true;
  if (minDate && dayjs(iso).isBefore(dayjs(minDate), "day")) return true;
  if (maxDate && dayjs(iso).isAfter(dayjs(maxDate), "day")) return true;
  if (Array.isArray(disabledDates) && disabledDates.includes(iso)) return true;
  if (typeof disabledDates === "function" && disabledDates(iso)) return true;
  return false;
}

export function SharedSingleDatePicker({
  value,
  onChange,
  calendarType = "jalali",
  disablePastDates = false,
  minDate,
  maxDate,
  disabledDates,
  placeholder = "انتخاب تاریخ",
  label = "تاریخ",
  labels,
  confirmText = "تایید",
  cancelText = "انصراف",
  showGregorianToggle = true,
  controlClassName,
}: SharedSingleDatePickerProps) {
  const text = {
    today: labels?.today ?? "برو به امروز",
    gregorian: labels?.gregorian ?? "تقویم میلادی",
    jalali: labels?.jalali ?? "تقویم شمسی",
    title: labels?.title ?? "انتخاب تاریخ",
  };
  const [activeCalendar, setActiveCalendar] =
    useState<CalendarType>(calendarType);
  const [open, setOpen] = useState(false);
  const [tempDate, setTempDate] = useState<string | null>(value);
  const [visibleMonth, setVisibleMonth] = useState(() =>
    asCalendar(dayjs(), calendarType).startOf("month"),
  );
  const holidayDetails = useHolidayCalendarDetails();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const buttonClass = `kooch-form-control ${
    controlClassName ?? "grid px-4 py-3 text-right transition"
  }`;
  const { holidayByDate } = useHolidayCalendarMonths({
    visibleMonth,
    calendarType: activeCalendar,
    enabled: open,
  });

  useEffect(() => setActiveCalendar(calendarType), [calendarType]);
  useEffect(
    () => holidayDetails.reset(),
    [activeCalendar, holidayDetails.reset, open, visibleMonth],
  );
  useEffect(() => {
    function onPointerDown(event: PointerEvent) {
      if (!wrapperRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, []);

  return (
    <div className="relative grid gap-2" ref={wrapperRef} dir="rtl">
      <span className="text-sm font-bold text-slate-700">{label}</span>
      <button
        className={buttonClass}
        data-control-active={open ? "true" : undefined}
        onClick={() => {
          setTempDate(value);
          setVisibleMonth(
            asCalendar(value ? dayjs(value) : dayjs(), activeCalendar).startOf(
              "month",
            ),
          );
          setOpen(true);
        }}
        type="button"
      >
        <span
          className={`font-bold ${value ? "text-slate-950" : "text-slate-400"}`}
        >
          {displayDate(value, activeCalendar, placeholder)}
        </span>
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-3 w-full min-w-[min(92vw,360px)] rounded-2xl border border-slate-200 bg-white p-4 shadow-2xl sm:w-[360px]">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm font-bold text-slate-700">{text.title}</p>
            {showGregorianToggle && (
              <button
                className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-bold text-slate-700 hover:border-[var(--theme-primary-border)] hover:text-[var(--theme-primary-text)]"
                onClick={() => {
                  const nextCalendar =
                    activeCalendar === "jalali" ? "gregorian" : "jalali";
                  setActiveCalendar(nextCalendar);
                  setVisibleMonth(
                    asCalendar(
                      tempDate ? dayjs(tempDate) : visibleMonth,
                      nextCalendar,
                    ).startOf("month"),
                  );
                }}
                type="button"
              >
                {activeCalendar === "jalali" ? text.gregorian : text.jalali}
              </button>
            )}
          </div>
          <div className="mb-4 flex items-center justify-between" dir="rtl">
            <button
              aria-label="ماه قبل"
              className="grid h-9 w-9 place-items-center rounded-full border border-slate-200 text-lg font-bold text-slate-700 hover:border-[var(--theme-primary-border)] hover:text-[var(--theme-primary-text)]"
              onClick={() =>
                setVisibleMonth((current) =>
                  asCalendar(current, activeCalendar)
                    .add(-1, "month")
                    .startOf("month"),
                )
              }
              type="button"
            >
              ›
            </button>
            <h3 className="text-center text-base font-bold text-slate-950">
              {monthTitle(visibleMonth, activeCalendar)}
            </h3>
            <button
              aria-label="ماه بعد"
              className="grid h-9 w-9 place-items-center rounded-full border border-slate-200 text-lg font-bold text-slate-700 hover:border-[var(--theme-primary-border)] hover:text-[var(--theme-primary-text)]"
              onClick={() =>
                setVisibleMonth((current) =>
                  asCalendar(current, activeCalendar)
                    .add(1, "month")
                    .startOf("month"),
                )
              }
              type="button"
            >
              ‹
            </button>
          </div>
          <div className="grid grid-cols-7 text-center text-xs font-bold text-slate-400">
            {weekdayLabels.map((weekday) => (
              <span className="py-1" key={weekday}>
                {weekday}
              </span>
            ))}
          </div>
          <div className="mt-1 grid grid-cols-7">
            {buildMonthDays(visibleMonth, activeCalendar).map((date, index) => {
              if (!date)
                return <span className="h-10" key={`empty-${index}`} />;
              const iso = toIso(date);
              const disabled = isDisabled(
                date,
                disablePastDates,
                minDate,
                maxDate,
                disabledDates,
              );
              const selected = tempDate === iso;
              const today = iso === dayjs().format(isoFormat);
              const holiday = holidayByDate.get(iso);
              const dayText = asCalendar(date, activeCalendar).format("D");
              const visualState = { selected, disabled, today };
              return (
                <button
                  aria-label={holidayAccessibleLabel(dayText, holiday)}
                  className={`h-10 rounded-[4px] text-sm font-bold transition ${holidayDayStateClass(visualState, holiday, "text-slate-700 hover:bg-[var(--theme-primary-soft)]")}`}
                  data-calendar-date={iso}
                  data-holiday={holiday ? "true" : undefined}
                  data-holiday-kind={
                    holiday?.isOfficialHoliday
                      ? "official"
                      : holiday?.isWeeklyHoliday
                        ? "weekly"
                        : undefined
                  }
                  disabled={disabled}
                  key={iso}
                  onBlur={holidayDetails.clearFocusedHoliday}
                  onClick={() => {
                    setTempDate(iso);
                    holidayDetails.selectHoliday(holiday);
                  }}
                  onFocus={() => holidayDetails.focusHoliday(holiday)}
                  onMouseEnter={() => holidayDetails.hoverHoliday(holiday)}
                  onMouseLeave={holidayDetails.clearHoveredHoliday}
                  type="button"
                >
                  <HolidayCalendarDayContent
                    dayText={dayText}
                    holiday={holiday}
                    state={visualState}
                  />
                </button>
              );
            })}
          </div>
          <div
            className="mt-5 border-t border-slate-100 pt-3"
            data-picker-footer="true"
          >
            <div className="sm:hidden" data-mobile-holiday-details-row="true">
              <HolidayCalendarDetails titles={holidayDetails.titles} />
            </div>
            <div
              className="grid min-h-12 w-full min-w-0 grid-cols-[auto_1fr_auto] items-center gap-3"
              data-picker-footer-grid="true"
              dir="rtl"
            >
              <div
                className="col-start-1 flex flex-nowrap items-center gap-2 justify-self-start whitespace-nowrap"
                data-picker-action-group="true"
              >
                <button
                  className="shrink-0 rounded-lg border border-slate-200 px-4 py-2 text-sm font-bold text-slate-700"
                  onClick={() => setOpen(false)}
                  type="button"
                >
                  {cancelText}
                </button>
                <button
                  className="shrink-0 rounded-lg bg-[var(--theme-primary)] px-5 py-2 text-sm font-bold text-white hover:bg-[var(--theme-primary-hover)]"
                  onClick={() => {
                    onChange(tempDate);
                    setOpen(false);
                  }}
                  type="button"
                >
                  {confirmText}
                </button>
              </div>
              <span
                aria-hidden="true"
                className="col-start-2 sm:hidden"
                data-mobile-footer-spacer="true"
              />
              <div
                className="col-start-2 hidden min-w-0 justify-self-stretch sm:block"
                data-desktop-holiday-details="true"
              >
                <HolidayCalendarDetails titles={holidayDetails.titles} />
              </div>
              <button
                className="col-start-3 min-w-0 max-w-full justify-self-end whitespace-normal rounded-lg border border-slate-200 px-4 py-2 text-sm font-bold text-slate-700 hover:border-[var(--theme-primary-border)] hover:text-[var(--theme-primary-text)]"
                data-picker-today-action="true"
                onClick={() => {
                  const today = dayjs();
                  setVisibleMonth(
                    asCalendar(today, activeCalendar).startOf("month"),
                  );
                  setTempDate(toIso(today));
                }}
                type="button"
              >
                {text.today}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
