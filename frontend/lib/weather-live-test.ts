import { apiRequest, ApiRequestError } from "@/lib/owner-api";
import { parseWeatherResponse } from "@/lib/weather";

const categories = ["Unknown", "Configuration", "Authentication", "Http", "NetworkOrTimeout", "Parsing", "Validation"];

export async function getLiveTestWeather(signal: AbortSignal) {
  return parseWeatherResponse(await apiRequest<unknown>("/weather/test-live", { cache: "no-store", signal }));
}

export function liveWeatherError(error: unknown) {
  if (!(error instanceof ApiRequestError)) return "خطا در دریافت مستقیم آب‌وهوا (Unknown).";
  const body = error.body && typeof error.body === "object" ? error.body as Record<string, unknown> : {};
  const category = typeof body.category === "string" && categories.includes(body.category) ? body.category : "Unknown";
  const providerStatus = typeof body.httpStatusCode === "number" && Number.isInteger(body.httpStatusCode) &&
    body.httpStatusCode >= 100 && body.httpStatusCode <= 599 ? `؛ HTTP سرویس: ${body.httpStatusCode}` : "";
  return `خطا در دریافت مستقیم آب‌وهوا (${category}؛ HTTP: ${error.status}${providerStatus}).`;
}
