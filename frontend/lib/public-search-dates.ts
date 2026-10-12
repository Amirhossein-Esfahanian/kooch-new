import { formatLocalIsoDate, parseLocalIsoDate } from "@/lib/date-utils";

export function getPublicSearchDateError(
  checkIn: string | null | undefined,
  checkOut: string | null | undefined,
): string | null {
  if (checkIn == null && checkOut == null) return null;
  if (checkIn == null || checkOut == null) {
    return "تاریخ ورود و خروج را کامل انتخاب کنید.";
  }
  const valid = (date: string) => /^\d{4}-\d{2}-\d{2}$/.test(date) &&
    formatLocalIsoDate(parseLocalIsoDate(date)) === date;
  if (!valid(checkIn) || !valid(checkOut)) {
    return "تاریخ ورود و خروج را اصلاح کنید.";
  }
  return checkOut <= checkIn ? "تاریخ خروج باید بعد از تاریخ ورود باشد." : null;
}
