const units = [
  "", "یک", "دو", "سه", "چهار", "پنج", "شش", "هفت", "هشت", "نه",
];
const teens = [
  "ده", "یازده", "دوازده", "سیزده", "چهارده", "پانزده", "شانزده",
  "هفده", "هجده", "نوزده",
];
const tens = [
  "", "", "بیست", "سی", "چهل", "پنجاه", "شصت", "هفتاد", "هشتاد", "نود",
];
const hundreds = [
  "", "صد", "دویست", "سیصد", "چهارصد", "پانصد", "ششصد",
  "هفتصد", "هشتصد", "نهصد",
];
const scales = ["", "هزار", "میلیون", "میلیارد", "تریلیون"];

function belowThousand(value: number): string {
  const parts: string[] = [];
  const hundred = Math.floor(value / 100);
  if (hundred) parts.push(hundreds[hundred]);

  const remainder = value % 100;
  if (remainder >= 10 && remainder < 20) {
    parts.push(teens[remainder - 10]);
  } else {
    const ten = Math.floor(remainder / 10);
    if (ten) parts.push(tens[ten]);
    if (remainder % 10) parts.push(units[remainder % 10]);
  }
  return parts.join(" و ");
}

/** Converts an exact integer to Persian words, without a currency unit. */
export function numberToPersianWords(
  value: number | string | null | undefined,
): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number" && !Number.isSafeInteger(value)) return null;

  const normalized = String(value).trim()
    .replace(/[۰-۹]/g, (digit) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(digit)))
    .replace(/[٠-٩]/g, (digit) => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)))
    .replace(/٬/g, ",");
  if (!/^-?(?:[0-9]+|[0-9]{1,3}(?:,[0-9]{3})+)$/.test(normalized)) return null;

  const negative = normalized.startsWith("-");
  const digits = normalized.replace(/[-,]/g, "").replace(/^0+/, "") || "0";
  // Five three-digit groups cover values through 999 trillion without losing precision.
  if (digits.length > scales.length * 3) return null;
  const numeric = Number(digits);
  if (!Number.isSafeInteger(numeric)) return null;
  if (numeric === 0) return "صفر";

  const parts: string[] = [];
  for (let index = 0; index < scales.length; index++) {
    const end = digits.length - index * 3;
    if (end <= 0) break;
    const group = Number(digits.slice(Math.max(0, end - 3), end));
    if (group) parts.unshift(`${belowThousand(group)}${scales[index] ? ` ${scales[index]}` : ""}`);
  }
  const words = parts.join(" و ");
  return negative ? `منفی ${words}` : words;
}
