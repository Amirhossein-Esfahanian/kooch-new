"use client";

import { useEffect, useState } from "react";

const themeKey = "kooch_theme";

const themes = [
  { value: "ocean", label: "آبی اقیانوسی", color: "#2563eb" },
  { value: "forest", label: "سبز جنگلی", color: "#15803d" },
  { value: "royal", label: "بنفش سلطنتی", color: "#7c3aed" },
  { value: "sunset", label: "نارنجی غروب", color: "#ea580c" },
] as const;

type ThemeName = (typeof themes)[number]["value"];

function applyTheme(theme: ThemeName) {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem(themeKey, theme);
}

export function ThemeSelector({ compact = false }: { compact?: boolean }) {
  const [theme, setTheme] = useState<ThemeName>("ocean");

  useEffect(() => {
    const saved = localStorage.getItem(themeKey) as ThemeName | null;
    const next = themes.some((item) => item.value === saved) ? saved! : "ocean";
    setTheme(next);
    applyTheme(next);
  }, []);

  return (
    <div className={compact ? "flex flex-wrap gap-2" : "grid gap-3"}>
      {!compact && (
        <div>
          <h3 className="text-lg font-black text-slate-950">رنگ محیط کاربری</h3>
          <p className="mt-1 text-sm text-slate-500">
            رنگ اصلی پنل و بخش‌های عمومی را انتخاب کنید.
          </p>
        </div>
      )}
      <div className="grid gap-2 sm:grid-cols-2">
        {themes.map((item) => {
          const active = theme === item.value;
          return (
            <button
              className={`flex items-center justify-between rounded-xl border px-3 py-2 text-sm font-bold transition ${
                active
                  ? "border-[var(--theme-primary)] bg-[var(--theme-primary-soft)] text-[var(--theme-primary-text)]"
                  : "border-slate-200 bg-white text-slate-700 hover:border-slate-300"
              }`}
              key={item.value}
              onClick={() => {
                setTheme(item.value);
                applyTheme(item.value);
              }}
              type="button"
            >
              <span>{item.label}</span>
              <span
                className="h-5 w-5 rounded-full border border-white shadow-sm"
                style={{ backgroundColor: item.color }}
              />
            </button>
          );
        })}
      </div>
    </div>
  );
}

