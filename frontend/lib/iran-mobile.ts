export const IRAN_MOBILE_MAX_LENGTH = 11;

const persianDigits = "۰۱۲۳۴۵۶۷۸۹";
const arabicDigits = "٠١٢٣٤٥٦٧٨٩";

export function normalizeIranMobileInput(value: string) {
  return value
    .replace(/[۰-۹]/g, (digit) => String(persianDigits.indexOf(digit)))
    .replace(/[٠-٩]/g, (digit) => String(arabicDigits.indexOf(digit)))
    .replace(/\D/g, "")
    .slice(0, IRAN_MOBILE_MAX_LENGTH);
}

export function validateIranMobile(value: string) {
  if (!value) return "شماره موبایل الزامی است.";
  if (!/^09\d{9}$/.test(value)) {
    return "شماره موبایل باید ۱۱ رقم، فقط عدد و با ۰۹ شروع شود؛ مانند 09132645025.";
  }
  return "";
}
