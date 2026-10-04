import { numberToPersianWords } from "@/lib/number-to-persian-words";

type KoochAmountInWordsProps = {
  value: number | string | null | undefined;
  currencyLabel?: string;
  id?: string;
  className?: string;
};

export function KoochAmountInWords({
  value,
  currencyLabel,
  id,
  className = "",
}: KoochAmountInWordsProps) {
  const words = numberToPersianWords(value);
  if (words === null) return null;

  const unit = currencyLabel?.trim();
  return (
    <p id={id} className={`text-xs font-normal leading-5 text-muted-foreground ${className}`.trim()}>
      {words}{unit ? ` ${unit}` : ""}
    </p>
  );
}
