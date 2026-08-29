export type PropertyCoordinates = {
  latitude: number;
  longitude: number;
};

export const KASHAN_MAP_CENTER: PropertyCoordinates = {
  latitude: 33.985,
  longitude: 51.41,
};

const COMPLETE_COORDINATE_PATTERN = /^-?(?:\d+|\d*\.\d+)$/;

export function normalizeCoordinate(value: number): number {
  return Number(value.toFixed(6));
}

export function toMapPosition(
  coordinates: PropertyCoordinates,
): [longitude: number, latitude: number] {
  return [coordinates.longitude, coordinates.latitude];
}

export function fromMapPosition(
  position: { lat: number; lng: number },
): PropertyCoordinates {
  return {
    latitude: normalizeCoordinate(position.lat),
    longitude: normalizeCoordinate(position.lng),
  };
}

export function parseCoordinateInput(value: string): number | null {
  const normalizedValue = value.trim();

  if (!COMPLETE_COORDINATE_PATTERN.test(normalizedValue)) {
    return null;
  }

  const parsedValue = Number(normalizedValue);
  return Number.isFinite(parsedValue) ? parsedValue : null;
}

export function isIncompleteCoordinateInput(value: string): boolean {
  const normalizedValue = value.trim();
  return (
    normalizedValue === "" ||
    normalizedValue === "-" ||
    /^-?\d+\.$/.test(normalizedValue)
  );
}

export function isLatitude(value: number): boolean {
  return value >= -90 && value <= 90;
}

export function isLongitude(value: number): boolean {
  return value >= -180 && value <= 180;
}
