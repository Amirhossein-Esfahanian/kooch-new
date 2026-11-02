"use client";

import { useSyncExternalStore } from "react";

type DashboardTheme = "light" | "dark";

export const dashboardThemeStorageKey = "kooch_dashboard_mode";

const listeners = new Set<() => void>();
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
  return { darkMode: theme === "dark", ready: theme !== null, toggleTheme };
}
