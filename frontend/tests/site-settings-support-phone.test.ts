import { afterEach, describe, expect, it, vi } from "vitest";
import { bookingSupportPhone, fetchPublicSiteSettings } from "@/lib/site-settings";

afterEach(() => vi.unstubAllGlobals());

describe("public booking Support phone", () => {
  it("reads the configured phone from the canonical public settings response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ "site.bookingSupportPhone": "+982112345678" }),
    }));

    const settings = await fetchPublicSiteSettings();
    expect(fetch).toHaveBeenCalledWith("/api/backend/site-settings/public");
    expect(bookingSupportPhone(settings)).toBe("+982112345678");
  });

  it("treats absent or blank support phone as unconfigured without substituting Property contact", () => {
    expect(bookingSupportPhone({ "property.phone": "02112345678" })).toBeNull();
    expect(bookingSupportPhone({ "site.bookingSupportPhone": "  " })).toBeNull();
    expect(bookingSupportPhone(null)).toBeNull();
  });
});
