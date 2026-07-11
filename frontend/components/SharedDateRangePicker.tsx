"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import dayjs, { Dayjs } from "dayjs";
import jalaliday from "jalaliday/dayjs";
import "dayjs/locale/fa";
import { KoochDialog } from "@/components/KoochDialog";

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
  dialogContentClassName?: string;
  dialogBodyClassName?: string;
  dialogFooterClassName?: string;
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
  /** Disabled Gregorian ISO dates or predicate. */
  disabledDates?: string[] | ((isoDate: string) => boolean);
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
  /** Open the calendar panel inside KoochDialog instead of the inline popover. */
  openOnDialog?: boolean;
}

type ActiveField = "startDate" | "endDate";

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

const persianDigits = ["۰", "۱", "۲", "۳", "۴", "۵", "۶", "۷", "۸", "۹"];

function toPersianDigits(value: string | number) {
  return String(value).replace(/\d/g, (digit) => persianDigits[Number(digit)]);
}

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
  if (!isoDate) return toPersianDigits(placeholder);
  return toPersianDigits(
    asCalendar(dayjs(isoDate), calendarType).format(
      calendarType === "jalali" ? "YYYY/MM/DD" : "YYYY-MM-DD",
    ),
  );
}

function monthTitle(month: Dayjs, calendarType: CalendarType) {
  const view = asCalendar(month, calendarType);
  const monthName =
    calendarType === "jalali"
      ? jalaliMonths[view.month()]
      : gregorianMonths[view.month()];
  return `${monthName} ${toPersianDigits(view.format("YYYY"))}`;
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

function isBefore(firstDate: string, secondDate: string) {
  return dayjs(firstDate).isBefore(dayjs(secondDate), "day");
}

function isAfter(firstDate: string, secondDate: string) {
  return dayjs(firstDate).isAfter(dayjs(secondDate), "day");
}

function isBetween(
  date: string,
  startDate: string | null,
  endDate: string | null,
) {
  if (!startDate || !endDate) return false;
  return isAfter(date, startDate) && isBefore(date, endDate);
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

export function SharedDateRangePicker({
  value,
  onChange,
  calendarType = "jalali",
  disablePastDates = false,
  minDate,
  maxDate,
  disabledDates,
  placeholderStart = "انتخاب تاریخ",
  placeholderEnd = "انتخاب تاریخ",
  labels,
  confirmText = "تایید",
  cancelText = "انصراف",
  showGregorianToggle = true,
  labelsAbove = false,
  showFieldLabels = true,
  controlClassName,
  openOnDialog = false,
  dialogContentClassName = "",
  dialogBodyClassName = "",
  dialogFooterClassName = "",
}: SharedDateRangePickerProps) {
  const text = {
    start: labels?.start ?? "تاریخ رفت",
    end: labels?.end ?? "تاریخ برگشت",
    today: labels?.today ?? "برو به امروز",
    gregorian: labels?.gregorian ?? "تقویم میلادی",
    jalali: labels?.jalali ?? "تقویم شمسی",
    rangeTitle: labels?.rangeTitle ?? "انتخاب بازه سفر",
  };
  const [activeCalendar, setActiveCalendar] =
    useState<CalendarType>(calendarType);
  const [activeField, setActiveField] = useState<ActiveField | null>(null);
  const [tempStartDate, setTempStartDate] = useState<string | null>(
    value.startDate,
  );
  const [tempEndDate, setTempEndDate] = useState<string | null>(value.endDate);
  const [visibleMonth, setVisibleMonth] = useState(() =>
    asCalendar(dayjs(), calendarType).startOf("month"),
  );
  const wrapperRef = useRef<HTMLDivElement>(null);
  const dateButtonBase =
    controlClassName ??
    "grid rounded-lg border border-border bg-background px-4 py-3 text-right text-foreground transition hover:bg-muted";
  const isOpen = activeField !== null;

  useEffect(() => setActiveCalendar(calendarType), [calendarType]);
  useEffect(() => {
    if (openOnDialog) return;

    function onPointerDown(event: PointerEvent) {
      if (!wrapperRef.current?.contains(event.target as Node))
        setActiveField(null);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [openOnDialog]);

  const months = useMemo(
    () => [
      visibleMonth,
      asCalendar(visibleMonth, activeCalendar).add(1, "month"),
    ],
    [activeCalendar, visibleMonth],
  );

  function open(field: ActiveField) {
    setActiveField(field);
    setTempStartDate(value.startDate);
    setTempEndDate(value.endDate);
    setVisibleMonth(
      asCalendar(
        value.startDate ? dayjs(value.startDate) : dayjs(),
        activeCalendar,
      ).startOf("month"),
    );
  }

  function selectDay(date: Dayjs) {
    if (isDisabled(date, disablePastDates, minDate, maxDate, disabledDates))
      return;
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

  function renderDateButton(
    field: ActiveField,
    label: string,
    valueDate: string | null,
    placeholder: string,
  ) {
    const active = activeField === field;
    return (
      <div className="grid gap-2">
        {labelsAbove && (
          <span className="text-sm font-semibold text-foreground">
            {toPersianDigits(label)}
          </span>
        )}
        <button
          className={`${dateButtonBase} ${active ? "border-[var(--theme-primary)] ring-2 ring-[var(--theme-primary-border)]" : "border-border hover:border-[var(--theme-primary-border)]"}`}
          onClick={() => open(field)}
          type="button"
        >
          {showFieldLabels && !labelsAbove && (
            <span className="text-xs font-semibold text-muted-foreground">
              {toPersianDigits(label)}
            </span>
          )}
          <span
            className={`${showFieldLabels && !labelsAbove ? "mt-1" : ""} font-semibold ${valueDate ? "text-foreground" : "text-muted-foreground"}`}
          >
            {displayDate(valueDate, activeCalendar, placeholder)}
          </span>
        </button>
      </div>
    );
  }

  const pickerPanel = (
    <div
      className={
        openOnDialog
          ? "text-card-foreground"
          : "absolute right-0 top-full z-50 mt-3 w-full min-w-[min(92vw,360px)] rounded-lg border border-border bg-popover p-4 text-popover-foreground shadow-2xl sm:w-[680px]"
      }
    >
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          {/* <p className="text-xs font-semibold text-muted-foreground">
                مبدا · مقصد
              </p> */}
          <p className="mt-1 text-sm font-semibold text-foreground">
            {toPersianDigits(text.rangeTitle)}
          </p>
        </div>
        {showGregorianToggle && (
          <button
            className="rounded-lg border border-border bg-background px-3 py-2 text-sm font-semibold text-foreground hover:bg-muted hover:text-foreground"
            onClick={() => {
              const nextCalendar =
                activeCalendar === "jalali" ? "gregorian" : "jalali";
              setActiveCalendar(nextCalendar);
              setVisibleMonth(
                asCalendar(
                  tempStartDate ? dayjs(tempStartDate) : visibleMonth,
                  nextCalendar,
                ).startOf("month"),
              );
            }}
            type="button"
          >
            {toPersianDigits(
              activeCalendar === "jalali" ? text.gregorian : text.jalali,
            )}
          </button>
        )}
      </div>
      <div
        className="mb-4 grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3"
        dir="rtl"
      >
        <button
          aria-label="ماه قبل"
          className="grid h-9 w-9 place-items-center rounded-full border border-border text-lg font-bold text-foreground hover:border-[var(--theme-primary-border)] hover:text-[var(--theme-primary-text)]"
          onClick={() =>
            setVisibleMonth((current) =>
              asCalendar(current, activeCalendar)
                .add(-1, "month")
                .startOf("month"),
            )
          }
          type="button"
        >
          ‹
        </button>

        <div className="grid min-w-0 gap-5 text-center sm:grid-cols-2">
          {months.map((month, monthIndex) => (
            <h3
              className={`truncate text-base font-bold text-foreground ${
                monthIndex === 1 ? "hidden sm:block" : ""
              }`}
              key={`${activeCalendar}-title-${month.format("YYYY-MM")}-${monthIndex}`}
            >
              {monthTitle(month, activeCalendar)}
            </h3>
          ))}
        </div>

        <button
          aria-label="ماه بعد"
          className="grid h-9 w-9 place-items-center rounded-full border border-border text-lg font-semibold text-foreground hover:border-[var(--theme-primary-border)] hover:text-[var(--theme-primary-text)]"
          onClick={() =>
            setVisibleMonth((current) =>
              asCalendar(current, activeCalendar)
                .add(1, "month")
                .startOf("month"),
            )
          }
          type="button"
        >
          ›
        </button>
      </div>
      <div className="grid gap-5 sm:grid-cols-2">
        {months.map((month, monthIndex) => (
          <section
            className={monthIndex === 1 ? "hidden sm:block" : ""}
            key={`${activeCalendar}-${month.format("YYYY-MM")}-${monthIndex}`}
          >
            <div className="grid grid-cols-7 text-center text-xs font-semibold text-muted-foreground">
              {weekdayLabels.map((weekday) => (
                <span className="py-1" key={toPersianDigits(weekday)}>
                  {toPersianDigits(weekday)}
                </span>
              ))}
            </div>
            <div className="mt-1 grid grid-cols-7">
              {buildMonthDays(month, activeCalendar).map((date, index) => {
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
                const isRangeStart = tempStartDate === iso;
                const isRangeEnd = tempEndDate === iso;
                const inRange = isBetween(iso, tempStartDate, tempEndDate);
                const selected = isRangeStart || isRangeEnd;
                const today = iso === dayjs().format(isoFormat);
                return (
                  <div
                    className={`h-10 ${inRange || selected ? "bg-[var(--theme-primary-soft)]" : ""} ${isRangeStart ? "rounded-r-[4px]" : ""} ${isRangeEnd ? "rounded-l-[4px]" : ""}`}
                    key={iso}
                  >
                    <button
                      className={`h-10 w-full text-sm font-semibold transition ${selected ? "rounded-[4px] bg-[var(--theme-primary)] text-primary-foreground shadow-sm" : inRange ? "text-[var(--theme-primary-text)] hover:bg-[var(--theme-primary-soft)]" : today ? "rounded-[4px] border border-[var(--theme-primary)] text-[var(--theme-primary-text)]" : "rounded-[4px] text-foreground hover:bg-[var(--theme-primary-soft)]"} ${disabled ? "cursor-not-allowed text-muted-foreground opacity-40 hover:bg-transparent" : ""}`}
                      disabled={disabled}
                      onClick={() => selectDay(date)}
                      type="button"
                    >
                      {toPersianDigits(
                        asCalendar(date, activeCalendar).format("D"),
                      )}
                    </button>
                  </div>
                );
              })}
            </div>
          </section>
        ))}
      </div>
      <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
        <div className="flex gap-2">
          <button
            className="rounded-lg bg-[var(--theme-primary)] px-5 py-2 text-sm font-semibold text-primary-foreground hover:bg-[var(--theme-primary-hover)] disabled:cursor-not-allowed disabled:opacity-50"
            disabled={!tempStartDate || !tempEndDate}
            onClick={() => {
              if (!tempStartDate || !tempEndDate) return;
              onChange({ startDate: tempStartDate, endDate: tempEndDate });
              setActiveField(null);
            }}
            type="button"
          >
            {toPersianDigits(confirmText)}
          </button>
          <button
            className="rounded-lg border border-border bg-background px-4 py-2 text-sm font-semibold text-foreground hover:bg-muted"
            onClick={() => setActiveField(null)}
            type="button"
          >
            {toPersianDigits(cancelText)}
          </button>
        </div>
        <button
          className="rounded-lg border border-border bg-background px-4 py-2 text-sm font-semibold text-foreground hover:bg-muted hover:text-foreground"
          onClick={() =>
            setVisibleMonth(
              asCalendar(dayjs(), activeCalendar).startOf("month"),
            )
          }
          type="button"
        >
          {toPersianDigits(text.today)}
        </button>
      </div>
    </div>
  );

  return (
    <div className="relative" ref={wrapperRef} dir="rtl">
      <div className="grid gap-3 sm:grid-cols-2">
        {renderDateButton(
          "startDate",
          text.start,
          value.startDate,
          placeholderStart,
        )}
        {renderDateButton("endDate", text.end, value.endDate, placeholderEnd)}
      </div>
      {isOpen && !openOnDialog && pickerPanel}
      {openOnDialog && (
        <KoochDialog
          contentClassName={dialogContentClassName}
          footerClassName={dialogFooterClassName}
          bodyClassName={`px-4 py-4 sm:px-6 ${dialogBodyClassName}`}
          onOpenChange={(nextOpen) => {
            if (!nextOpen) setActiveField(null);
          }}
          open={isOpen}
          size="md"
          title={toPersianDigits(text.rangeTitle)}
        >
          {pickerPanel}
        </KoochDialog>
      )}
    </div>
  );
}
