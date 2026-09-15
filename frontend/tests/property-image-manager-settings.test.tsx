import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  apiRequest: vi.fn(),
}));

vi.mock("@/lib/owner-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/owner-api")>();
  return { ...actual, apiRequest: mocks.apiRequest };
});

vi.mock("sonner", () => ({
  toast: { success: vi.fn() },
}));

vi.mock("@/components/MediaGallery", () => ({
  MediaGallery: ({
    constraints,
    disabled,
  }: {
    constraints: {
      maxFileSizeMb: number;
      minWidth: number;
      minHeight: number;
      maxImages: number;
    };
    disabled?: boolean;
  }) => (
    <div
      data-disabled={String(Boolean(disabled))}
      data-max-file-size={constraints.maxFileSizeMb}
      data-max-images={constraints.maxImages}
      data-min-height={constraints.minHeight}
      data-min-width={constraints.minWidth}
      data-testid="media-gallery"
    />
  ),
}));

import { PropertyImageManager } from "@/components/owner/PropertyImageManager";

describe("PropertyImageManager operational settings", () => {
  beforeEach(() => {
    mocks.apiRequest.mockReset();
  });

  it("loads and applies image constraints from the authenticated management endpoint", async () => {
    mocks.apiRequest.mockResolvedValue({
      "image.maxFileSizeMb": "7",
      "image.minWidth": "1200",
      "image.minHeight": "900",
      "image.maxImagesPerProperty": "45",
    });

    render(
      <PropertyImageManager
        images={[]}
        onImagesChange={vi.fn()}
        propertyId={12}
      />,
    );

    await waitFor(() =>
      expect(
        screen.getByTestId("media-gallery").getAttribute("data-max-file-size"),
      ).toBe("7"),
    );

    const gallery = screen.getByTestId("media-gallery");
    expect(mocks.apiRequest).toHaveBeenCalledWith(
      "/site-settings/management",
    );
    expect(gallery.getAttribute("data-min-width")).toBe("1200");
    expect(gallery.getAttribute("data-min-height")).toBe("900");
    expect(gallery.getAttribute("data-max-images")).toBe("45");
    expect(gallery.getAttribute("data-disabled")).toBe("false");
    expect(mocks.apiRequest).not.toHaveBeenCalledWith(
      "/site-settings/public",
    );
  });

  it.each([
    ["missing values", {}],
    ["request failure", new Error("forbidden")],
  ])("preserves existing fallbacks for %s", async (_case, result) => {
    if (result instanceof Error) {
      mocks.apiRequest.mockRejectedValue(result);
    } else {
      mocks.apiRequest.mockResolvedValue(result);
    }

    render(
      <PropertyImageManager
        images={[]}
        onImagesChange={vi.fn()}
        propertyId={12}
      />,
    );

    await waitFor(() =>
      expect(mocks.apiRequest).toHaveBeenCalledWith(
        "/site-settings/management",
      ),
    );

    const gallery = screen.getByTestId("media-gallery");
    expect(gallery.getAttribute("data-max-file-size")).toBe("2");
    expect(gallery.getAttribute("data-min-width")).toBe("800");
    expect(gallery.getAttribute("data-min-height")).toBe("600");
    expect(gallery.getAttribute("data-max-images")).toBe("30");
  });

  it("keeps uploads disabled when the property id is not available", async () => {
    mocks.apiRequest.mockResolvedValue({});

    render(
      <PropertyImageManager
        images={[]}
        onImagesChange={vi.fn()}
        propertyId={null}
      />,
    );

    await waitFor(() =>
      expect(mocks.apiRequest).toHaveBeenCalledWith(
        "/site-settings/management",
      ),
    );
    expect(
      screen.getByTestId("media-gallery").getAttribute("data-disabled"),
    ).toBe("true");
  });
});
