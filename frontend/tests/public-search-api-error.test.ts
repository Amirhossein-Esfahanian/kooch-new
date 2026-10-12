import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchPublicApi, PublicApiError } from "@/lib/public-properties";

afterEach(() => vi.unstubAllGlobals());

describe("public search API errors", () => {
  it.each([
    [{ message: "تاریخ خروج باید بعد از ورود باشد." }, "تاریخ خروج باید بعد از ورود باشد."],
    [{ errors: { checkIn: ["Invalid date"] } }, "اطلاعات جستجو را اصلاح کنید."],
  ])("keeps HTTP 400 status and useful validation feedback", async (body, message) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status: 400 })));
    await expect(fetchPublicApi("/properties?checkIn=bad")).rejects.toMatchObject({ status: 400, message });
    await expect(fetchPublicApi("/properties?checkIn=bad")).rejects.toBeInstanceOf(PublicApiError);
  });

  it("preserves unrelated failure messages and status", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 500 })));
    await expect(fetchPublicApi("/properties")).rejects.toMatchObject({ status: 500, message: "Could not load properties." });
  });
});
