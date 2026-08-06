const localizedDigitMap: Record<string, string> = {
  "۰": "0",
  "۱": "1",
  "۲": "2",
  "۳": "3",
  "۴": "4",
  "۵": "5",
  "۶": "6",
  "۷": "7",
  "۸": "8",
  "۹": "9",
  "٠": "0",
  "١": "1",
  "٢": "2",
  "٣": "3",
  "٤": "4",
  "٥": "5",
  "٦": "6",
  "٧": "7",
  "٨": "8",
  "٩": "9",
};

export function parseLocalizedAmount(value: string) {
  const normalized = value
    .replace(/[۰-۹٠-٩]/g, (digit) => localizedDigitMap[digit] ?? digit)
    .replace(/[^0-9]/g, "");
  if (!normalized) return null;

  const parsed = Number(normalized);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

export function formatLocalizedAmount(
  value: string | number | null | undefined,
) {
  if (value === null || value === undefined || value === "") return "";
  const parsed =
    typeof value === "number" ? value : parseLocalizedAmount(value);
  if (parsed === null || !Number.isFinite(parsed)) return "";

  return new Intl.NumberFormat("fa-IR", { maximumFractionDigits: 0 }).format(
    parsed,
  );
}

export function rawLocalizedAmount(value: string) {
  const parsed = parseLocalizedAmount(value);
  return parsed === null ? "" : String(parsed);
}
