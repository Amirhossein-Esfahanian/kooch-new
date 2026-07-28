import type { HolidayCalendarDay } from "@/lib/holiday-calendar";

export type HolidayCalendarDayVisualState = {
  selected: boolean;
  disabled: boolean;
  today: boolean;
  inRange?: boolean;
};

export function holidayDayStateClass(
  state: HolidayCalendarDayVisualState,
  holiday: HolidayCalendarDay | undefined,
  defaultClassName: string,
) {
  if (state.selected) {
    return "bg-[var(--theme-primary)] text-primary-foreground shadow-sm";
  }
  if (state.disabled) {
    return "cursor-not-allowed text-muted-foreground opacity-40 hover:bg-transparent";
  }
  if (state.inRange) {
    return "text-[var(--theme-primary-text)] hover:bg-[var(--theme-primary-soft)]";
  }
  if (state.today) {
    return "border border-[var(--theme-primary)] text-[var(--theme-primary-text)]";
  }
  if (holiday) {
    return "text-destructive hover:bg-[var(--destructive-soft)]";
  }
  return defaultClassName;
}

export function holidayAccessibleLabel(
  dayText: string,
  holiday: HolidayCalendarDay | undefined,
) {
  if (!holiday) return undefined;
  if (holiday.isOfficialHoliday) {
    const titles = holiday.occasionTitles.join("، ");
    return titles
      ? `${dayText}، تعطیل رسمی: ${titles}`
      : `${dayText}، تعطیل رسمی`;
  }
  return `${dayText}، تعطیل هفتگی`;
}

export function HolidayCalendarDayContent({
  dayText,
  holiday,
  state,
}: {
  dayText: string;
  holiday: HolidayCalendarDay | undefined;
  state: HolidayCalendarDayVisualState;
}) {
  const hasTitles = Boolean(
    holiday?.isOfficialHoliday && holiday.occasionTitles.length > 0,
  );
  const markerClassName = state.selected
    ? "bg-primary-foreground"
    : state.disabled
        ? "bg-muted-foreground"
      : state.inRange
        ? "bg-[var(--theme-primary-text)]"
        : "bg-destructive";

  return (
    <span className="relative inline-flex h-full w-full items-center justify-center">
      <span>{dayText}</span>
      {holiday && (
        <span
          aria-hidden="true"
          className={`absolute bottom-1 h-1 w-1 rounded-full ${markerClassName}`}
          data-holiday-marker="true"
        />
      )}
      {hasTitles && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute bottom-full start-1/2 z-20 mb-1 hidden w-max max-w-48 -translate-x-1/2 whitespace-normal rounded-md border border-border bg-popover px-2 py-1 text-xs font-medium leading-5 text-popover-foreground opacity-0 shadow-lg transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 sm:block motion-reduce:transition-none"
          data-holiday-tooltip="true"
        >
          {holiday!.occasionTitles.join("، ")}
        </span>
      )}
    </span>
  );
}

export function MobileHolidayDetails({ titles }: { titles: readonly string[] }) {
  return (
    <div
      aria-hidden="true"
      className="mt-2 min-h-6 text-center text-xs font-medium leading-5 text-destructive sm:hidden"
      data-mobile-holiday-details="true"
    >
      {titles.join("، ")}
    </div>
  );
}
