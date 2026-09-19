import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PropertyImageResponse } from "@/lib/owner-api";

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
    items,
    totalItemCount,
    onAdd,
  }: {
    constraints: {
      maxFileSizeMb: number;
      minWidth: number;
      minHeight: number;
      maxImages: number;
    };
    disabled?: boolean;
    items: PropertyImageResponse[];
    totalItemCount: number;
    onAdd: (files: File[]) => Promise<void>;
  }) => (
    <div
      data-disabled={String(Boolean(disabled))}
      data-max-file-size={constraints.maxFileSizeMb}
      data-max-images={constraints.maxImages}
      data-min-height={constraints.minHeight}
      data-min-width={constraints.minWidth}
      data-testid="media-gallery"
      data-total-count={totalItemCount}
    >
      {items.map((item) => <span key={item.id} data-testid="gallery-image">{item.id}</span>)}
      <button onClick={() => void onAdd([new File(["image"], "room.png", { type: "image/png" })])}>test-add</button>
    </div>
  ),
}));

import { PropertyImageManager } from "@/components/owner/PropertyImageManager";

describe("PropertyImageManager operational settings", () => {
  afterEach(() => vi.unstubAllGlobals());
  beforeEach(() => {
    mocks.apiRequest.mockReset();
  });

  const images: PropertyImageResponse[] = [
    { id: 1, roomTypeId: null, roomId: null, sortOrder: 4 },
    { id: 2, roomTypeId: 20, roomId: null, sortOrder: 1 },
    { id: 3, roomTypeId: 21, roomId: null, sortOrder: 2 },
    { id: 4, roomTypeId: null, roomId: null, sortOrder: 0 },
    { id: 5, roomTypeId: null, roomId: 99, sortOrder: 3 },
  ].map((item) => ({ ...item, propertyId: 12, url: `/images/${item.id}.png`,
    altText: null, caption: null, tag: null, isCover: item.id === 1, isGallery: true }));

  it.each([
    [undefined, [4, 1]],
    [20, [2]],
    [21, [3]],
  ])("filters gallery scope %s while retaining the property-wide count", async (fixedRoomTypeId, expected) => {
    mocks.apiRequest.mockResolvedValue({});
    render(<PropertyImageManager propertyId={12} fixedRoomTypeId={fixedRoomTypeId} images={images} onImagesChange={vi.fn()} />);
    await waitFor(() => expect(mocks.apiRequest).toHaveBeenCalled());
    expect(screen.getAllByTestId("gallery-image").map((node) => Number(node.textContent))).toEqual(expected);
    expect(screen.getByTestId("media-gallery").getAttribute("data-total-count")).toBe("5");
  });

  it.each([undefined, 20])("uploads with current scope metadata for %s", async (roomTypeId) => {
    mocks.apiRequest.mockResolvedValue({});
    const open = vi.fn();
    let body!: FormData;
    let complete!: () => void;
    vi.stubGlobal("XMLHttpRequest", class {
      upload = {};
      open = open;
      setRequestHeader = vi.fn();
      status = 201;
      responseText = JSON.stringify([images[1]]);
      onload: (() => void) | null = null;
      send(value: FormData) { body = value; complete = () => this.onload?.(); }
    });
    const onImagesChange = vi.fn();
    render(<PropertyImageManager propertyId={12} fixedRoomTypeId={roomTypeId} images={images} onImagesChange={onImagesChange} />);
    await waitFor(() => expect(mocks.apiRequest).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: "test-add" }));
    expect(open).toHaveBeenCalledWith("POST", "/api/backend/owner/properties/12/images/upload");
    expect(body.getAll("files")).toHaveLength(1);
    expect(body.get("roomTypeId")).toBe(roomTypeId ? "20" : null);
    expect(body.get("tag")).toBe(roomTypeId ? "room" : "other");
    expect(body.get("isCover")).toBe("false");
    expect(body.get("replaceImageId")).toBeNull();
    await act(async () => complete());
    expect(onImagesChange).toHaveBeenCalledWith([...images, images[1]]);
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
