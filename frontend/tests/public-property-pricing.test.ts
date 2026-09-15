import { describe, expect, it } from "vitest";
import { formatPrice } from "@/lib/public-properties";

describe("public property price formatting", () => {
  it("uses the supplied currency label without changing nightly formatting", () => {
    expect(formatPrice(1_250_000, "ریال آزمایشی")).toBe(
      "۱٬۲۵۰٬۰۰۰ ریال آزمایشی / شب",
    );
  });

  it("uses the canonical fallback and preserves no-price behavior", () => {
    expect(formatPrice(1_250_000)).toBe("۱٬۲۵۰٬۰۰۰ تومان / شب");
    expect(formatPrice(0, "ریال آزمایشی")).toBe(
      "قیمت پس از تعیین در تقویم",
    );
    expect(formatPrice(null, "ریال آزمایشی")).toBe(
      "قیمت پس از تعیین در تقویم",
    );
  });
});
