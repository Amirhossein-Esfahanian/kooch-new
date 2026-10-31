import { describe, expect, it } from "vitest";
import {
  normalizeIranianNationalCode,
  validateIranianNationalCode,
} from "@/lib/iran-national-code";

describe("Iranian NationalId registration validation", () => {
  it("normalizes Persian and Arabic digits without losing leading zeroes", () => {
    expect(normalizeIranianNationalCode("  ۱۲۳۴۵۶۷۸۹۱  ")).toBe("1234567891");
    expect(normalizeIranianNationalCode("٠٠١٢٣٤٥٦٧٩")).toBe("0012345679");
  });

  it("accepts checksum-valid English and Persian values", () => {
    expect(validateIranianNationalCode("1234567891")).toBe("");
    expect(validateIranianNationalCode("۱۲۳۴۵۶۷۸۹۱")).toBe("");
  });

  it("rejects missing, wrong-length, nonnumeric, repeated and invalid-checksum values", () => {
    for (const value of ["", "123456789", "12345678910", "12345678A1", "1111111111", "1234567890"]) {
      expect(validateIranianNationalCode(value)).not.toBe("");
    }
  });
});
