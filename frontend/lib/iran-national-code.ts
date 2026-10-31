import { toLatinDigits } from "@/lib/persian-digits";

export function normalizeIranianNationalCode(value: string): string {
  return toLatinDigits(value).replace(/[\s-]/g, "");
}

export function validateIranianNationalCode(value: string): string {
  const nationalCode = normalizeIranianNationalCode(value);
  if (!nationalCode) return "کد ملی الزامی است.";
  if (!/^\d{10}$/.test(nationalCode)) return "کد ملی باید ۱۰ رقم باشد.";
  if (/^(\d)\1{9}$/.test(nationalCode)) return "کد ملی معتبر نیست.";

  const sum = [...nationalCode.slice(0, 9)].reduce(
    (total, digit, index) => total + Number(digit) * (10 - index),
    0,
  );
  const remainder = sum % 11;
  const checkDigit = remainder < 2 ? remainder : 11 - remainder;
  return Number(nationalCode[9]) === checkDigit ? "" : "کد ملی معتبر نیست.";
}
