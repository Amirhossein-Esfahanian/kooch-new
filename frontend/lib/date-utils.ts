export function parseLocalIsoDate(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

export function formatLocalIsoDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

export function addLocalDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

export function getCheckInCheckoutDates(
  startDate: string,
  endDate: string,
): string[] {
  const dates: string[] = [];

  if (!startDate || !endDate) return dates;

  let current = parseLocalIsoDate(startDate);
  const checkout = parseLocalIsoDate(endDate);

  while (current < checkout) {
    dates.push(formatLocalIsoDate(current));
    current = addLocalDays(current, 1);
  }

  return dates;
}

export function getExclusiveRangeLength(
  startDate: string,
  endDate: string,
): number {
  if (!startDate || !endDate) return 0;

  const start = parseLocalIsoDate(startDate);
  const end = parseLocalIsoDate(endDate);

  if (start >= end) return 0;

  return Math.round(
    (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24),
  );
}

export function isBeforeLocalIsoDate(first: string, second: string): boolean {
  return parseLocalIsoDate(first) < parseLocalIsoDate(second);
}

export function isSameOrAfterLocalIsoDate(
  first: string,
  second: string,
): boolean {
  return parseLocalIsoDate(first) >= parseLocalIsoDate(second);
}
