"use client";

import { useEffect, useRef, useState } from "react";
import { useAuthSession } from "@/components/auth/AuthSessionProvider";
import { KoochButton } from "@/components/KoochButton";
import { useWeather } from "@/hooks/useWeather";
import type { WeatherResponse } from "@/lib/weather";
import { getLiveTestWeather, liveWeatherError } from "@/lib/weather-live-test";
import { CachedWeatherCard } from "./CachedWeatherCard";
import { WeatherCard } from "./WeatherCard";

export function MarketplaceWeatherCard({ className }: { className?: string }) {
  return process.env.NODE_ENV === "development"
    ? <DevelopmentWeatherCard className={className} />
    : <CachedWeatherCard className={className} layout="horizontal" />;
}

function DevelopmentWeatherCard({ className }: { className?: string }) {
  const { authenticated, platformRole, user } = useAuthSession();
  const { state, retry } = useWeather();
  const [local, setLocal] = useState(false);
  const [direct, setDirect] = useState<WeatherResponse | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const request = useRef<AbortController | null>(null);
  const allowed = local && authenticated && platformRole === "SuperAdmin";

  useEffect(() => {
    setLocal(["localhost", "127.0.0.1", "[::1]"].includes(window.location.hostname));
  }, []);
  useEffect(() => {
    setDirect(null); setError(null); setPending(false);
    return () => { request.current?.abort(); request.current = null; };
  }, [authenticated, platformRole, user?.userId]);

  async function testLive() {
    if (!allowed || request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setPending(true); setError(null); setDirect(null);
    try {
      const data = await getLiveTestWeather(controller.signal);
      if (!controller.signal.aborted) setDirect(data);
    } catch (failure) {
      if (!controller.signal.aborted) setError(liveWeatherError(failure));
    } finally {
      if (request.current === controller) {
        request.current = null;
        setPending(false);
      }
    }
  }

  return <div className="min-w-0" dir="rtl">
    <WeatherCard className={className} layout="horizontal" onRetry={retry}
      state={allowed && direct ? { status: "loaded", data: direct } : state}
      notice={allowed && <>
        {pending && <p role="status">در حال دریافت مستقیم آب‌وهوا…</p>}
        {direct && <p role="status">داده آزمایشی مستقیم</p>}
        {error && <p role="alert">{error}</p>}
      </>} />
    {allowed && <KoochButton className="mt-3 min-h-11" disabled={pending} loading={pending}
      onClick={() => void testLive()} size="sm" variant="outline">دریافت مستقیم آب‌وهوا</KoochButton>}
  </div>;
}
