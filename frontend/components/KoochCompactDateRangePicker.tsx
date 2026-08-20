"use client";

import {
  type CalendarDaySpacing,
  type CalendarType,
  type DateRangeFieldSize,
  SharedDateRangePicker,
  type SharedDateRangeValue,
} from "@/components/SharedDateRangePicker";

type DisabledDates = string[] | ((isoDate: string) => boolean);

export type KoochCompactDateRangePickerProps = {
  value: SharedDateRangeValue;
  onChange: (value: SharedDateRangeValue) => void;
  calendarType?: CalendarType;
  disablePastDates?: boolean;
  minDate?: string;
  maxDate?: string;
  disabledDates?: DisabledDates;
  daySpacing?: CalendarDaySpacing;
  fieldSize?: DateRangeFieldSize;
};

export function KoochCompactDateRangePicker({
  value,
  onChange,
  calendarType = "jalali",
  disablePastDates = false,
  minDate,
  maxDate,
  disabledDates,
  daySpacing = "normal",
  fieldSize = "standard",
}: KoochCompactDateRangePickerProps) {
  return (
    <div className="[&_[data-date-divider]+span]:ps-2">
      <SharedDateRangePicker
        autoCommit
        calendarType={calendarType}
        combinedField
        daySpacing={daySpacing}
        disabledDates={disabledDates}
        disablePastDates={disablePastDates}
        fieldSize={fieldSize}
        labels={{
          start: "تاریخ ورود",
          end: "تاریخ خروج",
          rangeTitle: "انتخاب تاریخ اقامت",
        }}
        maxDate={maxDate}
        minDate={minDate}
        onChange={onChange}
        placeholderEnd="تاریخ خروج"
        placeholderStart="تاریخ ورود"
        showFooterActions={false}
        showOccasions={false}
        value={value}
      />
    </div>
  );
}
