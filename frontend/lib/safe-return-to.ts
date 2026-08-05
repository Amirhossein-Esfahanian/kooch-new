export function safeInternalReturnTo(value?: string | null) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) {
    return null;
  }

  try {
    const parsed = new URL(value, "https://kooch.local");
    return parsed.origin === "https://kooch.local"
      ? `${parsed.pathname}${parsed.search}${parsed.hash}`
      : null;
  } catch {
    return null;
  }
}
