export function getRatingQuality(score: number) {
  if (score < 4) return { tone: "weak", label: "ضعیف" } as const;
  if (score < 6) return { tone: "average", label: "متوسط" } as const;
  if (score < 8) return { tone: "good", label: "خوب" } as const;
  if (score < 9) return { tone: "veryGood", label: "بسیار خوب" } as const;
  return { tone: "excellent", label: "عالی" } as const;
}
