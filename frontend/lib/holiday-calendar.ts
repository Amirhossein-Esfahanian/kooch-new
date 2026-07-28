import dayjs, { type Dayjs } from "dayjs";
import jalaliday from "jalaliday/dayjs";

dayjs.extend(jalaliday);

export type HolidayCalendarType = "jalali" | "gregorian";

export interface HolidayCalendarDay {
  date: string;
  solarYear: number;
  solarMonth: number;
  solarDay: number;
  isHoliday: true;
  isWeeklyHoliday: boolean;
  isOfficialHoliday: boolean;
  occasionTitles: readonly string[];
}

export interface HolidayCalendarDaysResponse {
  from: string;
  to: string;
  isRangeFullyCovered: boolean;
  coveredSolarYearFrom: number | null;
  coveredSolarYearTo: number | null;
  lastSuccessfulSyncAtUtc: string | null;
  days: readonly HolidayCalendarDay[];
}

export interface HolidayCalendarRange {
  from: string;
  to: string;
}

export class HolidayCalendarRequestError extends Error {
  constructor(
    message: string,
    public readonly status: number | null,
  ) {
    super(message);
    this.name = "HolidayCalendarRequestError";
  }
}

const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/;
const maximumInclusiveRangeDays = 93;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !isoDatePattern.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function isNullableInteger(value: unknown): value is number | null {
  return value === null || Number.isInteger(value);
}

function isNullableDateTime(value: unknown): value is string | null {
  return value === null || (typeof value === "string" && !Number.isNaN(Date.parse(value)));
}

function isHolidayDay(value: unknown): value is HolidayCalendarDay {
  if (!isRecord(value)) return false;
  return (
    isIsoDate(value.date) &&
    Number.isInteger(value.solarYear) &&
    Number.isInteger(value.solarMonth) &&
    Number.isInteger(value.solarDay) &&
    value.isHoliday === true &&
    typeof value.isWeeklyHoliday === "boolean" &&
    typeof value.isOfficialHoliday === "boolean" &&
    Array.isArray(value.occasionTitles) &&
    value.occasionTitles.every((title) => typeof title === "string")
  );
}

function parseHolidayCalendarResponse(value: unknown): HolidayCalendarDaysResponse {
  if (
    !isRecord(value) ||
    !isIsoDate(value.from) ||
    !isIsoDate(value.to) ||
    typeof value.isRangeFullyCovered !== "boolean" ||
    !isNullableInteger(value.coveredSolarYearFrom) ||
    !isNullableInteger(value.coveredSolarYearTo) ||
    !isNullableDateTime(value.lastSuccessfulSyncAtUtc) ||
    !Array.isArray(value.days) ||
    !value.days.every(isHolidayDay)
  ) {
    throw new HolidayCalendarRequestError("Holiday calendar response is invalid.", null);
  }

  return value as unknown as HolidayCalendarDaysResponse;
}

export async function getHolidayCalendarDays(
  from: string,
  to: string,
  signal?: AbortSignal,
): Promise<HolidayCalendarDaysResponse> {
  if (!isIsoDate(from) || !isIsoDate(to)) {
    throw new HolidayCalendarRequestError("Holiday calendar dates must use YYYY-MM-DD.", null);
  }

  let response: Response;
  try {
    const query = new URLSearchParams({ from, to });
    response = await fetch(`/api/backend/calendar/days?${query.toString()}`, { signal });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new HolidayCalendarRequestError("Holiday calendar could not be loaded.", null);
  }

  if (!response.ok) {
    throw new HolidayCalendarRequestError("Holiday calendar could not be loaded.", response.status);
  }

  try {
    return parseHolidayCalendarResponse(await response.json());
  } catch (error) {
    if (error instanceof HolidayCalendarRequestError) throw error;
    throw new HolidayCalendarRequestError("Holiday calendar response is invalid.", response.status);
  }
}

export function getVisibleMonthGregorianRange(
  visibleMonth: Dayjs,
  calendarType: HolidayCalendarType,
  monthCount: 1 | 2,
): HolidayCalendarRange {
  const calendarName = calendarType === "jalali" ? "jalali" : "gregory";
  const firstVisibleDay = visibleMonth.calendar(calendarName).startOf("month");
  const lastVisibleDay = firstVisibleDay.add(monthCount, "month").subtract(1, "day");
  const from = firstVisibleDay.calendar("gregory").format("YYYY-MM-DD");
  const to = lastVisibleDay.calendar("gregory").format("YYYY-MM-DD");
  const inclusiveDays = dayjs(to).diff(dayjs(from), "day") + 1;

  if (inclusiveDays > maximumInclusiveRangeDays) {
    throw new RangeError("Visible holiday calendar range exceeds 93 days.");
  }

  return { from, to };
}

export function holidayCalendarRangeKey(range: HolidayCalendarRange) {
  return `${range.from}:${range.to}`;
}
