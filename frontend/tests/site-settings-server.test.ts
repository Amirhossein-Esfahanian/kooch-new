import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { defaultSiteSettings } from "@/lib/site-settings";
import {
  fetchDefaultSeoMetadata,
  siteSettingsRevalidateSeconds,
} from "@/lib/site-settings.server";

const fallback = {
  title: defaultSiteSettings["site.defaultSeoTitle"],
  description: defaultSiteSettings["site.defaultSeoDescription"],
};

function response(payload: unknown, status = 200) {
  return {
    json: vi.fn().mockResolvedValue(payload),
    ok: status >= 200 && status < 300,
    status,
  } as unknown as Response;
}

describe("server Site Settings SEO metadata", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("KOOCH_BACKEND_ORIGIN", "https://api.kooch.test");
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("loads configured metadata from the backend with timed revalidation", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      response({
        "site.defaultSeoTitle": "عنوان تنظیم‌شده",
        "site.defaultSeoDescription": "توضیحات تنظیم‌شده",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchDefaultSeoMetadata()).resolves.toEqual({
      title: "عنوان تنظیم‌شده",
      description: "توضیحات تنظیم‌شده",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      new URL("https://api.kooch.test/api/site-settings/public"),
      { next: { revalidate: 300 } },
    );
    expect(siteSettingsRevalidateSeconds).toBe(300);
  });

  it.each([
    [{}, fallback],
    [
      { "site.defaultSeoDescription": "توضیحات" },
      { title: fallback.title, description: "توضیحات" },
    ],
    [
      { "site.defaultSeoTitle": "عنوان" },
      { title: "عنوان", description: fallback.description },
    ],
    [
      {
        "site.defaultSeoTitle": "   ",
        "site.defaultSeoDescription": "توضیحات",
      },
      { title: fallback.title, description: "توضیحات" },
    ],
    [
      {
        "site.defaultSeoTitle": "عنوان",
        "site.defaultSeoDescription": "   ",
      },
      { title: "عنوان", description: fallback.description },
    ],
  ])("uses per-field fallbacks for missing or blank values", async (payload, expected) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(payload)));

    await expect(fetchDefaultSeoMetadata()).resolves.toEqual(expected);
  });

  it.each([
    ["a non-success response", response({}, 503)],
    ["a malformed payload", response([])],
  ])("uses fallbacks for %s", async (_case, backendResponse) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(backendResponse));

    await expect(fetchDefaultSeoMetadata()).resolves.toEqual(fallback);
  });

  it("uses fallbacks when the fetch fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));

    await expect(fetchDefaultSeoMetadata()).resolves.toEqual(fallback);
  });

  it("uses fallbacks when the response is not valid JSON", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        json: vi.fn().mockRejectedValue(new SyntaxError("invalid JSON")),
        ok: true,
        status: 200,
      }),
    );

    await expect(fetchDefaultSeoMetadata()).resolves.toEqual(fallback);
  });

  it.each(["", "not a URL", "ftp://api.kooch.test"])(
    "does not fetch with an absent or invalid production origin: %s",
    async (origin) => {
      vi.stubEnv("KOOCH_BACKEND_ORIGIN", origin);
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);

      await expect(fetchDefaultSeoMetadata()).resolves.toEqual(fallback);
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it("uses the established localhost backend when development has no origin", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("KOOCH_BACKEND_ORIGIN", "");
    const fetchMock = vi.fn().mockResolvedValue(response({}));
    vi.stubGlobal("fetch", fetchMock);

    await fetchDefaultSeoMetadata();

    expect(fetchMock).toHaveBeenCalledWith(
      new URL("http://localhost:5081/api/site-settings/public"),
      { next: { revalidate: 300 } },
    );
  });
});
