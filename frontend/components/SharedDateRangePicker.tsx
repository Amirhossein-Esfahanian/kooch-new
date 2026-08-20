"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import dayjs, { Dayjs } from "dayjs";
import jalaliday from "jalaliday/dayjs";
import "dayjs/locale/fa";
import { KoochDialog } from "@/components/KoochDialog";
import {
  HolidayCalendarDayContent,
  HolidayCalendarDetails,
  holidayAccessibleLabel,
  holidayDayStateClass,
  useHolidayCalendarDetails,
} from "@/components/HolidayCalendarDayContent";
import { useHolidayCalendarMonths } from "@/hooks/useHolidayCalendarMonths";

dayjs.extend(jalaliday);

export type CalendarType = "jalali" | "gregorian";
export type CalendarDaySpacing = "compact" | "normal" | "comfortable";
export type DateRangeFieldSize = "standard" | "compact";

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
  /** @internal Render a single two-part range control. */
  combinedField?: boolean;
  /** @internal Commit and close as soon as the second date is selected. */
  autoCommit?: boolean;
  /** Keep the existing footer actions by default. */
  showFooterActions?: boolean;
  /** Load holiday metadata for day classification, styling, and labels. */
  loadHolidayData?: boolean;
  /** Show holiday occasion details in the picker footer. */
  showOccasions?: boolean;
  /** Calendar density. The normal value preserves the existing layout. */
  daySpacing?: CalendarDaySpacing;
  /** @internal Size of the combined field presentation. */
  fieldSize?: DateRangeFieldSize;
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

function displayDateParts(isoDate: string, calendarType: CalendarType) {
  const date = asCalendar(dayjs(isoDate), calendarType);
  const monthName =
    calendarType === "jalali"
      ? jalaliMonths[date.month()]
      : gregorianMonths[date.month()];

  return {
    date: `${toPersianDigits(date.format("D"))} ${monthName} ${toPersianDigits(date.format("YYYY"))}`,
    weekday: dayjs(isoDate).locale("fa").format("dddd"),
  };
}

function CalendarFieldIcon({ type }: { type: "in" | "out" }) {
  const icon =
    type === "in"
      ? "/svgs/calendar-arrow-down.svg"
      : "/svgs/calendar-arrow-up.svg";

  return (
    <span
      aria-hidden="true"
      className="h-7 w-7 shrink-0 bg-current"
      style={{
        WebkitMask: `url("${icon}") center / contain no-repeat`,
        mask: `url("${icon}") center / contain no-repeat`,
      }}
    />
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
  combinedField = false,
  autoCommit = false,
  showFooterActions = true,
  loadHolidayData = true,
  showOccasions = true,
  daySpacing = "normal",
  fieldSize = "standard",
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
  const holidayDetails = useHolidayCalendarDetails();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const combinedTriggerRef = useRef<HTMLButtonElement>(null);
  const dateButtonBase =
    controlClassName ??
    "grid rounded-lg border border-border bg-background px-4 py-3 text-right text-foreground transition hover:bg-muted";
  const isOpen = activeField !== null;
  const { holidayByDate } = useHolidayCalendarMonths({
    visibleMonth,
    calendarType: activeCalendar,
    includeResponsiveSecondMonth: true,
    enabled: isOpen && loadHolidayData,
  });

  useEffect(() => setActiveCalendar(calendarType), [calendarType]);
  useEffect(
    () => holidayDetails.reset(),
    [activeCalendar, holidayDetails.reset, isOpen, visibleMonth],
  );
  useEffect(() => {
    if (openOnDialog) return;

    function onPointerDown(event: PointerEvent) {
      if (!wrapperRef.current?.contains(event.target as Node)) {
        setTempStartDate(value.startDate);
        setTempEndDate(value.endDate);
        setActiveField(null);
      }
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [openOnDialog, value.endDate, value.startDate]);

  useEffect(() => {
    if (!isOpen || openOnDialog) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setTempStartDate(value.startDate);
      setTempEndDate(value.endDate);
      setActiveField(null);
      window.requestAnimationFrame(() => combinedTriggerRef.current?.focus());
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [isOpen, openOnDialog, value.endDate, value.startDate]);

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
    const holiday = holidayByDate.get(iso);
    holidayDetails.selectHoliday(holiday);
    let nextStartDate: string;
    let nextEndDate: string | null;

    if (!tempStartDate || tempEndDate) {
      nextStartDate = iso;
      nextEndDate = null;
    } else if (isBefore(iso, tempStartDate)) {
      nextStartDate = iso;
      nextEndDate = tempStartDate;
    } else {
      nextStartDate = tempStartDate;
      nextEndDate = iso;
    }

    setTempStartDate(nextStartDate);
    setTempEndDate(nextEndDate);

    if (autoCommit && nextEndDate) {
      onChange({ startDate: nextStartDate, endDate: nextEndDate });
      setActiveField(null);
      window.requestAnimationFrame(() => combinedTriggerRef.current?.focus());
    }
  }

  function renderCombinedField() {
    const start = value.startDate
      ? displayDateParts(value.startDate, activeCalendar)
      : null;
    const end = value.endDate
      ? displayDateParts(value.endDate, activeCalendar)
      : null;
    const compact = fieldSize === "compact";

    return (
      <button
        ref={combinedTriggerRef}
        aria-expanded={isOpen}
        aria-haspopup="dialog"
        aria-label={`${text.start}: ${start?.date ?? placeholderStart}، ${text.end}: ${end?.date ?? placeholderEnd}`}
        className={`grid w-full min-w-0 grid-cols-[minmax(0,1fr)_1px_minmax(0,1fr)] items-stretch rounded-lg border bg-background text-right text-foreground transition hover:border-[var(--theme-primary-border)] hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${compact ? "min-h-12 px-3 py-1.5" : "min-h-16 px-4 py-2.5"} ${isOpen ? "border-[var(--theme-primary)] ring-2 ring-[var(--theme-primary-border)]" : "border-border"}`}
        data-combined-date-field="true"
        data-field-size={fieldSize}
        onClick={() => open("startDate")}
        onKeyDown={(event) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          open("startDate");
        }}
        type="button"
      >
        <span
          className={`flex min-w-0 items-center ${compact ? "gap-2" : "gap-3"}`}
        >
          <CalendarFieldIcon type="in" />
          <span className={`grid min-w-0 ${compact ? "gap-0" : "gap-0.5"}`}>
            {start ? (
              <>
                <span
                  className={`${compact ? "text-xs" : "text-sm"} font-semibold leading-5`}
                  data-date-primary="start"
                >
                  {start.date}
                </span>
                <span
                  className="text-xs leading-4 text-muted-foreground"
                  data-date-weekday="start"
                >
                  {start.weekday}
                </span>
              </>
            ) : (
              <span
                className={`${compact ? "text-xs" : "text-sm"} font-medium text-muted-foreground`}
              >
                {placeholderStart}
              </span>
            )}
          </span>
        </span>

        <span
          aria-hidden="true"
          className="my-1 w-px bg-border"
          data-date-divider="true"
        />

        <span
          className={`flex min-w-0 items-center ${compact ? "gap-2 pe-3" : "gap-3 pe-4"}`}
        >
          <CalendarFieldIcon type="out" />
          <span className={`grid min-w-0 ${compact ? "gap-0" : "gap-0.5"}`}>
            {end ? (
              <>
                <span
                  className={`${compact ? "text-xs" : "text-sm"} font-semibold leading-5`}
                  data-date-primary="end"
                >
                  {end.date}
                </span>
                <span
                  className="text-xs leading-4 text-muted-foreground"
                  data-date-weekday="end"
                >
                  {end.weekday}
                </span>
              </>
            ) : (
              <span
                className={`${compact ? "text-xs" : "text-sm"} font-medium text-muted-foreground`}
              >
                {placeholderEnd}
              </span>
            )}
          </span>
        </span>
      </button>
    );
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
          : `absolute right-0 top-full z-50 mt-3 w-full min-w-[min(92vw,360px)] rounded-lg border border-border bg-popover text-popover-foreground shadow-2xl sm:w-[680px] ${daySpacing === "compact" ? "p-3" : daySpacing === "comfortable" ? "p-5" : "p-4"}`
      }
      aria-label={combinedField ? toPersianDigits(text.rangeTitle) : undefined}
      data-calendar-day-spacing={daySpacing}
      role={combinedField ? "dialog" : undefined}
    >
      <div
        className={`${daySpacing === "compact" ? "mb-3" : daySpacing === "comfortable" ? "mb-5" : "mb-4"} flex flex-wrap items-center justify-between gap-3`}
      >
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
            className="  rounded-lg border border-border bg-background px-2 py-1 text-xs font-semibold text-foreground hover:bg-muted hover:text-foreground"
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
        className={`${daySpacing === "compact" ? "mb-3" : daySpacing === "comfortable" ? "mb-5" : "mb-4"} grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3`}
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

        <div
          className={`grid min-w-0 text-center sm:grid-cols-2 ${daySpacing === "compact" ? "gap-3" : daySpacing === "comfortable" ? "gap-7" : "gap-5"}`}
        >
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
      <div
        className={`grid sm:grid-cols-2 ${daySpacing === "compact" ? "gap-3" : daySpacing === "comfortable" ? "gap-7" : "gap-5"}`}
      >
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
            <div
              className={`${daySpacing === "compact" ? "mt-0" : daySpacing === "comfortable" ? "mt-2 gap-y-1" : "mt-1"} grid grid-cols-7`}
            >
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
                const holiday = holidayByDate.get(iso);
                const dayText = toPersianDigits(
                  asCalendar(date, activeCalendar).format("D"),
                );
                const visualState = { selected, disabled, today, inRange };
                return (
                  <div
                    className={`h-10 ${inRange || selected ? "bg-[var(--theme-primary-soft)]" : ""} ${isRangeStart ? "rounded-r-[4px]" : ""} ${isRangeEnd ? "rounded-l-[4px]" : ""}`}
                    key={iso}
                  >
                    <button
                      aria-label={holidayAccessibleLabel(dayText, holiday)}
                      className={`h-10 w-full rounded-[4px] text-sm font-semibold transition ${holidayDayStateClass(visualState, holiday, "text-foreground hover:bg-[var(--theme-primary-soft)]")}`}
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
                      onBlur={holidayDetails.clearFocusedHoliday}
                      onClick={() => selectDay(date)}
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
                  </div>
                );
              })}
            </div>
          </section>
        ))}
      </div>
      {showFooterActions && (
        <div
          className="mt-5 border-t border-border pt-3"
          data-picker-footer="true"
        >
          <div className="sm:hidden" data-mobile-holiday-details-row="true">
            {showOccasions && (
              <HolidayCalendarDetails titles={holidayDetails.titles} />
            )}
          </div>
          <div
            className="grid min-h-12 w-full min-w-0 grid-cols-[auto_1fr_auto] items-center gap-3 sm:grid-cols-[minmax(max-content,1fr)_minmax(220px,360px)_minmax(max-content,1fr)]"
            data-picker-footer-grid="true"
            dir="rtl"
          >
            <div
              className="col-start-1 flex flex-nowrap items-center gap-2 justify-self-start whitespace-nowrap"
              data-picker-action-group="true"
            >
              <button
                className="shrink-0 rounded-lg bg-[var(--theme-primary)] px-5 py-2 text-sm font-semibold text-primary-foreground hover:bg-[var(--theme-primary-hover)] disabled:cursor-not-allowed disabled:opacity-50"
                disabled={!tempStartDate || !tempEndDate}
                onClick={() => {
                  if (!tempStartDate || !tempEndDate) return;

                  onChange({
                    startDate: tempStartDate,
                    endDate: tempEndDate,
                  });

                  setActiveField(null);
                }}
                type="button"
              >
                {toPersianDigits(confirmText)}
              </button>

              <button
                className="shrink-0 rounded-lg border border-border bg-background px-4 py-2 text-sm font-semibold text-foreground hover:bg-muted"
                onClick={() => setActiveField(null)}
                type="button"
              >
                {toPersianDigits(cancelText)}
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
              {showOccasions && (
                <HolidayCalendarDetails titles={holidayDetails.titles} />
              )}
            </div>

            <button
              className="col-start-3 min-w-0 max-w-full justify-self-end whitespace-normal rounded-lg border border-border bg-background px-4 py-2 text-sm font-semibold text-foreground hover:bg-muted hover:text-foreground"
              data-picker-today-action="true"
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
      )}
    </div>
  );

  return (
    <div className="relative" ref={wrapperRef} dir="rtl">
      {combinedField ? (
        renderCombinedField()
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {renderDateButton(
            "startDate",
            text.start,
            value.startDate,
            placeholderStart,
          )}
          {renderDateButton("endDate", text.end, value.endDate, placeholderEnd)}
        </div>
      )}
      {isOpen && !openOnDialog && pickerPanel}
      {openOnDialog && (
        <KoochDialog
          contentClassName={dialogContentClassName}
          footerClassName={dialogFooterClassName}
          bodyClassName={`px-4 py-4 sm:px-6 ${dialogBodyClassName}`}
          onOpenChange={(nextOpen) => {
            if (!nextOpen) {
              setTempStartDate(value.startDate);
              setTempEndDate(value.endDate);
              setActiveField(null);
            }
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
