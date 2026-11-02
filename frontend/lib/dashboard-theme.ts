"use client";

import { useLayoutEffect, useSyncExternalStore } from "react";
import { dashboardThemeStorageKey, isDashboardPath } from "./dashboard-theme-bootstrap";

export { dashboardThemeStorageKey } from "./dashboard-theme-bootstrap";

type DashboardTheme = "light" | "dark";

const listeners = new Set<() => void>();
let mountedSurfaces = 0;
let memoryTheme: DashboardTheme = "light";
let storageOverride: DashboardTheme | null = null;

function readTheme(): DashboardTheme {
  if (storageOverride !== null) return storageOverride;
  try {
    return window.localStorage.getItem(dashboardThemeStorageKey) === "dark" ? "dark" : "light";
  } catch {
    return memoryTheme;
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === dashboardThemeStorageKey || event.key === null) listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

function toggleTheme() {
  memoryTheme = readTheme() === "dark" ? "light" : "dark";
  try {
    window.localStorage.setItem(dashboardThemeStorageKey, memoryTheme);
    storageOverride = null;
  } catch {
    // Keep navigation stable even when browser storage is unavailable.
    storageOverride = memoryTheme;
  }
  listeners.forEach((listener) => listener());
}

const serverTheme = () => null;

export function useDashboardTheme() {
  const theme = useSyncExternalStore(subscribe, readTheme, serverTheme);
  useLayoutEffect(() => {
    if (theme === null || !isDashboardPath(window.location.pathname)) return;
    mountedSurfaces += 1;
    document.documentElement.setAttribute("data-dashboard-mode", theme);
    return () => {
      mountedSurfaces -= 1;
      if (mountedSurfaces === 0) document.documentElement.removeAttribute("data-dashboard-mode");
    };
  }, [theme]);
  return { darkMode: theme === "dark", ready: theme !== null, toggleTheme };
}
