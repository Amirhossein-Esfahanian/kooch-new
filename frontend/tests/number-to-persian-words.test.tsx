import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { KoochAmountInWords } from "@/components/KoochAmountInWords";
import { numberToPersianWords } from "@/lib/number-to-persian-words";

describe("numberToPersianWords", () => {
  it.each([
    [0, "صفر"],
    [1, "یک"],
    [12, "دوازده"],
    [40, "چهل"],
    [105, "صد و پنج"],
    [1_000, "یک هزار"],
    [1_250, "یک هزار و دویست و پنجاه"],
    [12_500_000, "دوازده میلیون و پانصد هزار"],
    [1_000_000_000, "یک میلیارد"],
    [1_000_000_000_000, "یک تریلیون"],
    [1_002_000_003, "یک میلیارد و دو میلیون و سه"],
    [-123, "منفی صد و بیست و سه"],
  ])("converts %s exactly", (value, expected) => {
    expect(numberToPersianWords(value)).toBe(expected);
  });

  it.each(["1250000", "1,250,000", "۱٬۲۵۰٬۰۰۰", "١٢٥٠٠٠٠"])(
    "accepts supported digits and grouping: %s",
    (value) => expect(numberToPersianWords(value)).toBe("یک میلیون و دویست و پنجاه هزار"),
  );

  it.each(["", "   ", "1,25,000", "12abc", "1.5", "-", "--1", "9007199254740992", "1000000000000000", Number.NaN, 1.5, null, undefined])(
    "returns null for empty, malformed, fractional or unsupported values: %s",
    (value) => expect(numberToPersianWords(value)).toBeNull(),
  );

  it("renders only supplied currency text and hides invalid input", () => {
    const { rerender } = render(<KoochAmountInWords value="12,500,000" currencyLabel="ریال" />);
    expect(screen.getByText("دوازده میلیون و پانصد هزار ریال")).toBeTruthy();
    rerender(<KoochAmountInWords value="12,500,000" currencyLabel="واحد آزمایشی" />);
    expect(screen.getByText("دوازده میلیون و پانصد هزار واحد آزمایشی")).toBeTruthy();
    rerender(<KoochAmountInWords value="bad" currencyLabel="ریال" />);
    expect(screen.queryByText(/ریال|واحد آزمایشی/)).toBeNull();
  });
});
