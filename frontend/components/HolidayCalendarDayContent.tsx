import { useCallback, useState } from "react";
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

function officialHolidayTitles(
  holiday: HolidayCalendarDay | undefined,
): readonly string[] {
  return holiday?.isOfficialHoliday ? holiday.occasionTitles : [];
}

function formatHolidayTitles(titles: readonly string[]) {
  const seen = new Set<string>();
  const formattedTitles: string[] = [];

  for (const title of titles) {
    const formattedTitle = title
      .replace(/\s*\[[^\]]*\]/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    if (!formattedTitle || seen.has(formattedTitle)) continue;
    seen.add(formattedTitle);
    formattedTitles.push(formattedTitle);
  }

  return formattedTitles;
}

export function useHolidayCalendarDetails() {
  const [selectedTitles, setSelectedTitles] = useState<readonly string[]>([]);
  const [hoveredTitles, setHoveredTitles] = useState<readonly string[] | null>(
    null,
  );
  const [focusedTitles, setFocusedTitles] = useState<readonly string[] | null>(
    null,
  );

  const reset = useCallback(() => {
    setSelectedTitles([]);
    setHoveredTitles(null);
    setFocusedTitles(null);
  }, []);
  const selectHoliday = useCallback(
    (holiday: HolidayCalendarDay | undefined) => {
      setSelectedTitles(officialHolidayTitles(holiday));
    },
    [],
  );
  const hoverHoliday = useCallback(
    (holiday: HolidayCalendarDay | undefined) => {
      const titles = officialHolidayTitles(holiday);
      setHoveredTitles(titles.length > 0 ? titles : null);
    },
    [],
  );
  const focusHoliday = useCallback(
    (holiday: HolidayCalendarDay | undefined) => {
      const titles = officialHolidayTitles(holiday);
      setFocusedTitles(titles.length > 0 ? titles : null);
    },
    [],
  );
  const clearHoveredHoliday = useCallback(() => setHoveredTitles(null), []);
  const clearFocusedHoliday = useCallback(() => setFocusedTitles(null), []);

  return {
    titles: hoveredTitles ?? focusedTitles ?? selectedTitles,
    selectHoliday,
    hoverHoliday,
    focusHoliday,
    clearHoveredHoliday,
    clearFocusedHoliday,
    reset,
  };
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
    </span>
  );
}

export function HolidayCalendarDetails({
  titles,
}: {
  titles: readonly string[];
}) {
  const formattedTitles = formatHolidayTitles(titles);

  return (
    <div
      aria-hidden="true"
      className="flex h-10 min-w-0 w-full items-center justify-center overflow-hidden px-2 text-center text-xs font-medium leading-5 text-destructive"
      data-holiday-details="true"
    >
      {formattedTitles.length > 0 && (
        <span
          className="line-clamp-2 w-full [overflow-wrap:anywhere]"
          data-holiday-details-content="true"
        >
          {formattedTitles.join(" • ")}
        </span>
      )}
    </div>
  );
}
