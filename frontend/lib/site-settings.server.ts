import "server-only";

import { defaultSiteSettings } from "@/lib/site-settings";

const publicSiteSettingsPath = "/api/site-settings/public";
const emittedWarnings = new Set<string>();

export const siteSettingsRevalidateSeconds = 300;

export type DefaultSeoMetadata = {
  title: string;
  description: string;
};

const fallbackSeoMetadata: DefaultSeoMetadata = {
  title: defaultSiteSettings["site.defaultSeoTitle"],
  description: defaultSiteSettings["site.defaultSeoDescription"],
};

function warnOnce(message: string) {
  if (emittedWarnings.has(message)) return;
  emittedWarnings.add(message);
  console.warn(message);
}

function resolveBackendOrigin() {
  const configuredOrigin = process.env.KOOCH_BACKEND_ORIGIN?.trim();
  if (!configuredOrigin) {
    if (process.env.NODE_ENV === "development") {
      return new URL("http://localhost:5081");
    }

    warnOnce(
      "KOOCH_BACKEND_ORIGIN is not configured; using fallback SEO metadata.",
    );
    return null;
  }

  try {
    const origin = new URL(configuredOrigin);
    if (origin.protocol !== "http:" && origin.protocol !== "https:") {
      throw new Error("Unsupported backend origin protocol.");
    }

    return new URL(origin.origin);
  } catch {
    warnOnce(
      "KOOCH_BACKEND_ORIGIN is invalid; using fallback SEO metadata.",
    );
    return null;
  }
}

function configuredValue(value: unknown, fallback: string) {
  return typeof value === "string" && value.trim()
    ? value.trim()
    : fallback;
}

export async function fetchDefaultSeoMetadata(): Promise<DefaultSeoMetadata> {
  const backendOrigin = resolveBackendOrigin();
  if (!backendOrigin) return fallbackSeoMetadata;

  try {
    const response = await fetch(
      new URL(publicSiteSettingsPath, backendOrigin),
      { next: { revalidate: siteSettingsRevalidateSeconds } },
    );
    if (!response.ok) {
      warnOnce(
        `Public Site Settings returned HTTP ${response.status}; using fallback SEO metadata.`,
      );
      return fallbackSeoMetadata;
    }

    const settings: unknown = await response.json();
    if (!settings || typeof settings !== "object" || Array.isArray(settings)) {
      warnOnce(
        "Public Site Settings returned an invalid payload; using fallback SEO metadata.",
      );
      return fallbackSeoMetadata;
    }

    const values = settings as Record<string, unknown>;
    return {
      title: configuredValue(
        values["site.defaultSeoTitle"],
        fallbackSeoMetadata.title,
      ),
      description: configuredValue(
        values["site.defaultSeoDescription"],
        fallbackSeoMetadata.description,
      ),
    };
  } catch {
    warnOnce(
      "Public Site Settings could not be loaded; using fallback SEO metadata.",
    );
    return fallbackSeoMetadata;
  }
}
