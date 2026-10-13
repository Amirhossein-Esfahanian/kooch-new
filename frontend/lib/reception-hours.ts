export interface ReceptionHours {
  regularReceptionFrom: string | null;
  regularReceptionUntil: string | null;
}

function clockSeconds(value: string): number | null {
  const match = /^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d)(?:\.(\d{1,7}))?)?$/.exec(value);
  if (!match) return null;

  return Number(match[1]) * 3600 + Number(match[2]) * 60 +
    Number(match[3] ?? 0) + Number(`0.${match[4] ?? "0"}`);
}

export function isOvernightReceptionWindow(from: string, until: string): boolean | null {
  const start = clockSeconds(from);
  const end = clockSeconds(until);
  return start === null || end === null || start === end ? null : start > end;
}

export function isArrivalWithinReceptionWindow(
  arrivalTime: string,
  from: string,
  until: string,
): boolean | null {
  const arrival = clockSeconds(arrivalTime);
  const start = clockSeconds(from);
  const end = clockSeconds(until);
  if (arrival === null || start === null || end === null || start === end) return null;

  return start < end
    ? arrival >= start && arrival <= end
    : arrival >= start || arrival <= end;
}
