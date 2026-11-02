import type { GuestSelectorValue } from "@/components/GuestSelector";
import { formatLocalIsoDate, parseLocalIsoDate } from "@/lib/date-utils";

export type BookingDates = { startDate: string | null; endDate: string | null };
export type BookingUrlContext = { dates: BookingDates; guests: GuestSelectorValue };
export type PropertyEntryKind = "book" | "properties";
export type BookingPropertyEntry = {
  kind: PropertyEntryKind;
  propertyId: number;
  propertySlug: string;
  rooms?: number;
};

type Query = Pick<URLSearchParams, "get" | "getAll">;

function count(value: string | null, minimum: number): number | null {
  if (value === null || !/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= minimum ? parsed : null;
}

function date(value: string | null): string | null {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    formatLocalIsoDate(parseLocalIsoDate(value)) === value ? value : null;
}

function readComposition(params: Query) {
  const children = count(params.get("children"), 0);
  // Read old repeated parameters as well as the canonical comma-separated value.
  const ages = params.getAll("childAges").flatMap((value) => value.split(","));
  const valid = children !== null && (children === 0 || (
    ages.length === children && ages.every((age) => {
      const parsed = count(age, 0);
      return parsed !== null && parsed <= 17;
    })
  ));
  return { valid, children: valid ? children : 0, childAges: valid && children > 0 ? ages.map(Number) : [] };
}

export function readBookingContext(params: Query): BookingUrlContext {
  const startDate = date(params.get("checkIn"));
  const endDate = date(params.get("checkOut"));
  const composition = readComposition(params);
  return {
    dates: { startDate, endDate: endDate && (!startDate || endDate > startDate) ? endDate : null },
    guests: {
      rooms: count(params.get("rooms"), 1) ?? 1,
      adults: count(params.get("adults") ?? params.get("guests"), 1) ?? 2,
      children: composition.children,
      childAges: composition.childAges,
    },
  };
}

export function writeBookingContext(context: BookingUrlContext, params = new URLSearchParams()): URLSearchParams {
  const raw = new URLSearchParams({
    rooms: String(context.guests.rooms), adults: String(context.guests.adults),
    children: String(context.guests.children), childAges: context.guests.childAges.join(","),
  });
  if (context.dates.startDate) raw.set("checkIn", context.dates.startDate);
  if (context.dates.endDate) raw.set("checkOut", context.dates.endDate);
  const { dates, guests } = readBookingContext(raw);
  for (const key of ["checkIn", "checkOut", "rooms", "adults", "guests", "children", "childAges"]) params.delete(key);
  if (dates.startDate) params.set("checkIn", dates.startDate);
  if (dates.endDate) params.set("checkOut", dates.endDate);
  params.set("rooms", String(guests.rooms));
  params.set("adults", String(guests.adults));
  params.set("children", String(guests.children));
  if (guests.childAges.length) params.set("childAges", guests.childAges.join(","));
  return params;
}

export function initialAvailabilityContextKey(params: Query, propertySlug: string): string | null {
  const { dates, guests } = readBookingContext(params);
  if (!dates.startDate || !dates.endDate || dates.startDate < formatLocalIsoDate(new Date()) ||
      count(params.get("rooms"), 1) === null ||
      count(params.get("adults") ?? params.get("guests"), 1) === null || !readComposition(params).valid) return null;
  return JSON.stringify([propertySlug, dates.startDate, dates.endDate,
    guests.rooms, guests.adults, guests.children, guests.childAges]);
}

export function validBookingPropertyEntry(
  value: unknown,
  items: readonly { propertyId: number; propertySlug: string }[],
): BookingPropertyEntry | undefined {
  if (!value || typeof value !== "object" || items.length === 0) return undefined;
  const entry = value as Partial<BookingPropertyEntry>;
  if ((entry.kind !== "book" && entry.kind !== "properties") ||
      entry.propertyId !== items[0].propertyId || entry.propertySlug !== items[0].propertySlug ||
      items.some((item) => item.propertyId !== entry.propertyId || item.propertySlug !== entry.propertySlug)) return undefined;
  return {
    kind: entry.kind, propertyId: entry.propertyId, propertySlug: entry.propertySlug,
    ...(typeof entry.rooms === "number" && Number.isSafeInteger(entry.rooms) && entry.rooms > 0 ? { rooms: entry.rooms } : {}),
  };
}
