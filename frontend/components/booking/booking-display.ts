import { getCheckInCheckoutDates, parseLocalIsoDate } from "@/lib/date-utils";
import type { BookingMode } from "@/lib/booking-sessions";

const persianDateFormatter = new Intl.DateTimeFormat(
  "fa-IR-u-ca-persian-nu-arabext",
  { year: "numeric", month: "long", day: "numeric" },
);

const persianDateTimeFormatter = new Intl.DateTimeFormat(
  "fa-IR-u-ca-persian-nu-arabext",
  {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  },
);

const persianNumberFormatter = new Intl.NumberFormat(
  "fa-IR-u-nu-arabext",
  { maximumFractionDigits: 0 },
);

export function formatBookingDate(value: string) {
  return persianDateFormatter.format(parseLocalIsoDate(value));
}

export function formatBookingDateRange(checkIn: string, checkOut: string) {
  return `${formatBookingDate(checkIn)} تا ${formatBookingDate(checkOut)}`;
}

export function formatBookingDeadline(value: string) {
  return persianDateTimeFormatter.format(new Date(value));
}

export function formatBookingCountdown(
  seconds: number,
  expiredLabel = "مهلت پایان یافته است",
) {
  if (seconds <= 0) return expiredLabel;

  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  const remainingSeconds = seconds % 60;
  const clock = [hours, minutes, remainingSeconds]
    .map((value) => persianNumberFormatter.format(value).padStart(2, "۰"))
    .join(":");

  return days > 0
    ? `${persianNumberFormatter.format(days)} روز و ${clock}`
    : clock;
}

export function bookingModePresentation(mode: BookingMode) {
  return mode === "Instant"
    ? { icon: "✓", label: "رزرو آنی" }
    : { icon: "⌛", label: "نیازمند تأیید مالک" };
}

export function countBookingNights(
  ranges: Array<{ checkIn: string; checkOut: string }>,
) {
  const nights = new Set<string>();
  for (const range of ranges) {
    getCheckInCheckoutDates(range.checkIn, range.checkOut).forEach((date) =>
      nights.add(date),
    );
  }
  return nights.size;
}
