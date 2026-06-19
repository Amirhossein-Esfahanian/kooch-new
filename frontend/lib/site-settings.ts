export type SiteSettingsMap = Record<string, string>;

export const defaultSiteSettings: SiteSettingsMap = {
  "site.name": "کوچ",
  "site.logoUrl": "",
  "site.footerText": "اقامتگاه‌های سنتی و میزبانی محلی در کاشان",
  "home.heroTitle": "اقامتگاه بعدی خود را پیدا کنید",
  "home.heroSubtitle": "رزرو اقامتگاه‌های سنتی، بوتیک‌هتل‌ها و خانه‌های خاص",
  "home.heroBackgroundUrl":
    "https://images.unsplash.com/photo-1566073771259-6a8506099945?auto=format&fit=crop&w=2200&q=85",
  "home.searchButtonText": "جستجوی اقامتگاه",
  "home.popularSectionTitle": "اقامتگاه‌های محبوب",
  "home.popularSectionSubtitle": "اقامتگاه‌های منتخب برای سفر بعدی شما",
  "site.defaultSeoTitle": "کوچ | رزرو اقامتگاه سنتی",
  "site.defaultSeoDescription": "رزرو اقامتگاه‌های سنتی، بوتیک‌هتل‌ها و خانه‌های خاص",
};

export async function fetchPublicSiteSettings(): Promise<SiteSettingsMap> {
  const response = await fetch("/api/backend/site-settings/public");
  if (!response.ok) {
    throw new Error("Could not load site settings.");
  }
  return response.json();
}

export function mergeSiteSettings(settings: SiteSettingsMap | null | undefined) {
  return { ...defaultSiteSettings, ...(settings ?? {}) };
}

export function settingValue(settings: SiteSettingsMap, key: string) {
  return settings[key] ?? defaultSiteSettings[key] ?? "";
}
