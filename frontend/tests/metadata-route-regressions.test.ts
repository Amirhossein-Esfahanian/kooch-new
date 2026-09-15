import { describe, expect, it } from "vitest";
import { metadata as staysMetadata } from "@/app/stays/page";
import { generateMetadata as generateStayMetadata } from "@/app/stays/[slug]/page";

describe("route-specific metadata", () => {
  it("keeps the stays index title override", () => {
    expect(staysMetadata).toEqual({ title: "Explore stays" });
  });

  it("keeps the stay detail title and description override", async () => {
    await expect(
      generateStayMetadata({ params: Promise.resolve({ slug: "cedar-house" }) }),
    ).resolves.toEqual({
      title: "The Cedar House",
      description: "A warm timber retreat tucked between forest and sea.",
    });
  });
});
