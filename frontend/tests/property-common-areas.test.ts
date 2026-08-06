import { beforeEach, describe, expect, it, vi } from "vitest";
import { replacePropertyCommonAreas } from "@/lib/owner-api";

describe("property common-area API contract", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("uses the owner property collection PUT route for create and update", async () => {
    const response = [
      { id: 5, propertyId: 17, name: "حیاط", description: "کنار حوض", sortOrder: 1 },
    ];
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(response), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await expect(replacePropertyCommonAreas(17, [
      { name: "حیاط", description: "کنار حوض", sortOrder: 1 },
    ])).resolves.toEqual(response);

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/backend/owner/properties/17/common-areas",
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({
          commonAreas: [{ name: "حیاط", description: "کنار حوض", sortOrder: 1 }],
        }),
      }),
    );
  });

  it("deletes all common areas by replacing the collection with an empty list", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify([]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await replacePropertyCommonAreas(17, []);

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/backend/owner/properties/17/common-areas",
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({ commonAreas: [] }),
      }),
    );
  });
});
