const persianDigits = ["۰", "۱", "۲", "۳", "۴", "۵", "۶", "۷", "۸", "۹"] as const;

export function toPersianDigits(
  value: string | number | null | undefined,
): string {
  if (value === null || value === undefined) return "";

  return String(value)
    .replace(/[0-9]/g, (digit) => persianDigits[Number(digit)])
    .replace(/[٠-٩]/g, (digit) =>
      persianDigits["٠١٢٣٤٥٦٧٨٩".indexOf(digit)],
    );
}
