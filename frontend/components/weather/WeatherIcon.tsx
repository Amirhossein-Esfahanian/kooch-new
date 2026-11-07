import { KoochIcon } from "@/components/KoochIcon";

export function WeatherIcon({ code }: { code: string }) {
  if (code === "clear-day") return <KoochIcon name="light" />;
  if (code === "partly-cloudy-night") return <KoochIcon name="dark" />;
  const rain = ["rain", "showers-day", "showers-night", "thunder-rain", "thunder-showers-day", "thunder-showers-night"].includes(code);
  const snow = ["snow", "snow-showers-day", "snow-showers-night"].includes(code);
  const cloud = code === "cloudy" || code === "partly-cloudy-day" || rain || snow;
  return <svg aria-hidden="true" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    {code === "clear-night" ? <path d="M20 15A9 9 0 0 1 9 4a9 9 0 1 0 11 11Z" /> : cloud ? <>
      {code === "partly-cloudy-day" && <path d="M6 3V1m-4 4L1 4m10 0 1-1M3 9a4 4 0 0 1 7-4" />}
      <path d="M6 16h12a4 4 0 0 0 0-8h-1a6 6 0 0 0-11-1A4.5 4.5 0 0 0 6 16Z" />
      {rain && <path d="m7 19-1 3m7-3-1 3m7-3-1 3" />}
      {snow && <path d="M7 19v3m-1.5-2.25 3 1.5m0-1.5-3 1.5M17 19v3m-1.5-2.25 3 1.5m0-1.5-3 1.5" />}
      {code.startsWith("thunder") && <path d="m13 12-2 4h3l-2 4" />}
    </> : code === "wind" ? <path d="M3 8h12a3 3 0 1 0-3-3M3 12h16a2 2 0 1 1-2 2M3 16h7a3 3 0 1 1-3 3" /> :
      code === "fog" ? <path d="M4 6h16M2 10h15M6 14h16M3 18h15" /> :
        <><circle cx="12" cy="12" r="9" /><path d="M10 9a2 2 0 1 1 3 1.7c-1 .6-1 1.3-1 2.3m0 3h.01" /></>}
  </svg>;
}
