const OPTIMIZED_REMOTE_PREFIXES = ["https://images.unsplash.com/"];

export function shouldBypassImageOptimization(src: string) {
  return (
    !src.startsWith("/") &&
    !OPTIMIZED_REMOTE_PREFIXES.some((prefix) => src.startsWith(prefix))
  );
}
