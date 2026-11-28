"use client";

import {
  CalendarType,
  SharedDateLabels,
  SharedDateRangePicker,
  SharedDateRangeValue,
} from "@/components/SharedDateRangePicker";
import {
  SharedSingleDateLabels,
  SharedSingleDatePicker,
} from "@/components/SharedSingleDatePicker";

type DisabledDates = string[] | ((isoDate: string) => boolean);

type BaseDatePickerProps = {
  calendarType?: CalendarType;
  disablePastDates?: boolean;
  minDate?: string;
  maxDate?: string;
  disabledDates?: DisabledDates;
  confirmText?: string;
  cancelText?: string;
  showGregorianToggle?: boolean;
  controlClassName?: string;
};

export type KoochSingleDatePickerProps = BaseDatePickerProps & {
  mode: "single";
  value: string | null;
  onChange: (value: string | null) => void;
  label?: string | null;
  placeholder?: string;
  labels?: SharedSingleDateLabels;
  size?: "default" | "compact";
  autoConfirmOnSelect?: boolean;
  /** true portals to body; "dialog" escapes overflow without leaving the dialog focus scope. */
  portal?: boolean | "dialog";
};

export type KoochDateRangePickerProps = BaseDatePickerProps & {
  mode: "range";
  value: SharedDateRangeValue;
  onChange: (value: SharedDateRangeValue) => void;
  openOnDialog?: boolean;
  placeholderStart?: string;
  placeholderEnd?: string;
  labels?: SharedDateLabels;
  labelsAbove?: boolean;
  showFieldLabels?: boolean;
  dialogContentClassName?: string;
  dialogBodyClassName?: string;
  dialogFooterClassName?: string;
  autoCommit?: boolean;
  combinedField?: boolean;
  showCombinedFieldLabels?: boolean;
  fieldSize?: "standard" | "compact";
};

export type KoochDatePickerProps =
  | KoochSingleDatePickerProps
  | KoochDateRangePickerProps;

export function KoochDatePicker(props: KoochDatePickerProps) {
  if (props.mode === "single") {
    const { mode: _mode, ...singleProps } = props;
    return <SharedSingleDatePicker {...singleProps} />;
  }

  const { mode: _mode, ...rangeProps } = props;
  return <SharedDateRangePicker {...rangeProps} />;
}
