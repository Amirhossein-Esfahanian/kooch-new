"use client";

import {
  KoochDatePicker,
  KoochDateRangePickerProps,
} from "@/components/KoochDatePicker";
import { SharedDateRangeValue } from "@/components/SharedDateRangePicker";

export type DateRangeValue = SharedDateRangeValue;

export function DateRangePicker(props: Omit<KoochDateRangePickerProps, "mode">) {
  return <KoochDatePicker {...props} mode="range" />;
}
