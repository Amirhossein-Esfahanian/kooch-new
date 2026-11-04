export function publicFrontendOrigin(value: string | undefined): string | null {
  const candidate = value?.trim();
  // Accept an origin only, not a URL that URL() silently normalizes into one.
  if (!candidate || !/^https?:\/\/[^/?#\\@\s]+\/?$/i.test(candidate)) return null;
  try {
    const url = new URL(candidate);
    if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) return null;
    const isLoopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (process.env.NODE_ENV === "production" && url.protocol !== "https:" && !isLoopback) return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function publicBookingUrl(slug: unknown): string | null {
  const origin = publicFrontendOrigin(process.env.NEXT_PUBLIC_KOOCH_PUBLIC_ORIGIN);
  if (!origin || typeof slug !== "string" || !slug || slug === "." || slug === ".." ||
    /[\s/\\?#\u0000-\u001f\u007f]/.test(slug)) return null;
  try {
    return `${origin}/book/${encodeURIComponent(slug)}`;
  } catch {
    return null;
  }
}
