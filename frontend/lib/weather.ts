export interface WeatherDay {
  date: string;
  minTemperature: number;
  maxTemperature: number;
  precipitationProbability: number;
  conditions: string;
  icon: string;
}

export interface WeatherResponse {
  status: "available" | "stale" | "unavailable";
  unavailableReason: string | null;
  locationKey: string;
  provider: string;
  attribution: string;
  unitGroup: "metric" | "us" | "uk";
  fetchedAtUtc: string | null;
  days: WeatherDay[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function isWeatherDay(value: unknown): value is WeatherDay {
  return isRecord(value) && isDate(value.date) &&
    typeof value.minTemperature === "number" && Number.isFinite(value.minTemperature) &&
    typeof value.maxTemperature === "number" && Number.isFinite(value.maxTemperature) &&
    value.minTemperature <= value.maxTemperature &&
    typeof value.precipitationProbability === "number" && value.precipitationProbability >= 0 && value.precipitationProbability <= 100 &&
    typeof value.conditions === "string" && value.conditions.trim().length > 0 && typeof value.icon === "string";
}

export async function getWeather(): Promise<WeatherResponse> {
  const response = await fetch("/api/backend/weather");
  if (!response.ok) throw new Error("دریافت اطلاعات آب‌وهوا ممکن نشد.");
  const value: unknown = await response.json();
  return parseWeatherResponse(value);
}

export function parseWeatherResponse(value: unknown): WeatherResponse {
  if (!isRecord(value) || !["available", "stale", "unavailable"].includes(String(value.status)) ||
    !(value.unavailableReason === null || typeof value.unavailableReason === "string") ||
    typeof value.locationKey !== "string" || typeof value.provider !== "string" || typeof value.attribution !== "string" ||
    !["metric", "us", "uk"].includes(String(value.unitGroup)) ||
    !(value.fetchedAtUtc === null || (typeof value.fetchedAtUtc === "string" && Number.isFinite(Date.parse(value.fetchedAtUtc)))) ||
    !Array.isArray(value.days) || !value.days.every(isWeatherDay) ||
    value.days.some((day, index, days) => index > 0 && day.date <= days[index - 1].date) ||
    (value.status !== "unavailable" && (value.days.length === 0 || value.fetchedAtUtc === null))) {
    throw new Error("پاسخ آب‌وهوا معتبر نیست.");
  }
  return value as unknown as WeatherResponse;
}

export function createWeatherLoader(fetcher = getWeather, now = () => Date.now()) {
  let cached: { response: WeatherResponse; expiresAt: number; businessDate: string } | null = null;
  let pending: Promise<WeatherResponse> | null = null;
  return {
    load() {
      const businessDate = weatherBusinessDate(now());
      if (cached && cached.expiresAt > now() && cached.businessDate === businessDate) return Promise.resolve(cached.response);
      if (pending) return pending;
      pending = fetcher().then((response) => {
        cached = { response, expiresAt: now() + 30 * 60 * 1000, businessDate };
        return response;
      }).finally(() => { pending = null; });
      return pending;
    },
  };
}

const businessClock = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Tehran", calendar: "gregory", numberingSystem: "latn",
  year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
});
function weatherClockParts(now: number) {
  return Object.fromEntries(businessClock.formatToParts(new Date(now)).map(({ type, value }) => [type, value]));
}
export function weatherBusinessDate(now = Date.now()) {
  const parts = weatherClockParts(now);
  return `${parts.year}-${parts.month}-${parts.day}`;
}
export function weatherMidnightDelay(now = Date.now()) {
  const parts = weatherClockParts(now);
  const seconds = Number(parts.hour) * 3600 + Number(parts.minute) * 60 + Number(parts.second);
  return (86400 - seconds) * 1000 - (now % 1000);
}
export function weatherForToday(data: WeatherResponse, today: string): WeatherResponse {
  if (data.status === "unavailable") return data;
  const days = data.days.filter((day) => day.date >= today).slice(0, 7);
  const first = Date.parse(`${today}T12:00:00Z`);
  if (days.length !== 7 || days.some((day, index) => Date.parse(`${day.date}T12:00:00Z`) !== first + index * 86400000)) {
    return { ...data, status: "unavailable", unavailableReason: "forecast_expired", days: [] };
  }
  const older = data.fetchedAtUtc && weatherBusinessDate(Date.parse(data.fetchedAtUtc)) < today;
  return { ...data, status: older ? "stale" : data.status, days };
}

const weekday = new Intl.DateTimeFormat("fa-IR", { weekday: "long", timeZone: "UTC" });
const forecastDate = new Intl.DateTimeFormat("fa-IR", { day: "numeric", month: "long", timeZone: "UTC" });
const updatedDate = new Intl.DateTimeFormat("fa-IR", {
  year: "numeric", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Tehran",
});
export const weatherNumber = new Intl.NumberFormat("fa-IR", { maximumFractionDigits: 1 });
export function weatherDayLabel(date: string) {
  const value = new Date(`${date}T12:00:00Z`);
  return { weekday: weekday.format(value), date: forecastDate.format(value) };
}
export function weatherUpdatedLabel(date: string) { return updatedDate.format(new Date(date)); }
