import { describe, expect, it } from "vitest";
import {
  formatLocalizedAmount,
  parseLocalizedAmount,
  rawLocalizedAmount,
} from "@/lib/localized-amount";

describe("localized amount formatting", () => {
  it("formats editable amounts with Persian digits and three-digit grouping", () => {
    expect(formatLocalizedAmount("1234567")).toBe("۱٬۲۳۴٬۵۶۷");
  });

  it("accepts Persian and Arabic digits and exposes a separator-free backend value", () => {
    expect(parseLocalizedAmount("۱٬۲۳۴٬۵۶۷")).toBe(1_234_567);
    expect(rawLocalizedAmount("١,٢٣٤,٥٦٧")).toBe("1234567");
  });

  it("keeps an empty input empty", () => {
    expect(formatLocalizedAmount("")).toBe("");
    expect(rawLocalizedAmount(" ")).toBe("");
  });
});
