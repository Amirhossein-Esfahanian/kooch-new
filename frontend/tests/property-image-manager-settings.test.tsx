import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PropertyImageResponse } from "@/lib/owner-api";
import { useState } from "react";

const mocks = vi.hoisted(() => ({
  apiRequest: vi.fn(),
  deleteFailure: vi.fn(),
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
    onDelete,
  }: {
    constraints: {
      maxFileSizeMb: number;
      minWidth: number;
      minHeight: number;
      maxImages: number;
    };
    disabled?: boolean;
    items: (PropertyImageResponse & { isMain: boolean })[];
    totalItemCount: number;
    onAdd: (files: File[]) => Promise<void>;
    onDelete: (image: PropertyImageResponse) => Promise<void>;
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
      {items.map((item) => <span key={item.id} data-testid="gallery-image" data-main={item.isMain}>
        {item.id}<button onClick={() => void onDelete(item).catch(mocks.deleteFailure)}>{`delete-${item.id}`}</button>
      </span>)}
      <button onClick={() => void onAdd([new File(["image"], "room.png", { type: "image/png" })])}>test-add</button>
    </div>
  ),
}));

import { PropertyImageManager } from "@/components/owner/PropertyImageManager";

describe("PropertyImageManager operational settings", () => {
  afterEach(() => vi.unstubAllGlobals());
  beforeEach(() => {
    mocks.apiRequest.mockReset();
    mocks.deleteFailure.mockReset();
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
    expect(screen.getAllByTestId("gallery-image").map((node) => Number(node.firstChild?.textContent))).toEqual(expected);
    expect(screen.getByTestId("media-gallery").getAttribute("data-total-count")).toBe("5");
  });

  it.each([undefined, 20])("refreshes the authoritative collection after deletion in scope %s", async (roomTypeId) => {
    const removedId = roomTypeId ? 2 : 1;
    const refreshed = images.filter((item) => item.id !== removedId).map((item) => ({ ...item, isCover: item.id === 4 }));
    mocks.apiRequest.mockImplementation(async (path: string, options?: RequestInit) => {
      if (options?.method === "DELETE") return undefined;
      return path.endsWith("/images") ? refreshed : {};
    });
    function Harness() {
      const [value, setValue] = useState(images);
      return <PropertyImageManager propertyId={12} fixedRoomTypeId={roomTypeId} images={value} onImagesChange={setValue} />;
    }
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: `delete-${removedId}` }));
    await waitFor(() => expect(mocks.apiRequest).toHaveBeenCalledWith("/owner/properties/12/images"));
    expect(mocks.apiRequest).toHaveBeenCalledWith(`/owner/property-images/${removedId}`, { method: "DELETE" });
    await waitFor(() => expect(screen.queryByRole("button", { name: `delete-${removedId}` })).toBeNull());
    if (!roomTypeId) {
      expect(screen.getByTestId("gallery-image").getAttribute("data-main")).toBe("true");
      expect(screen.getByRole("button", { name: "delete-4" })).toBeTruthy();
    } else {
      expect(screen.queryAllByTestId("gallery-image")).toHaveLength(0);
    }
  });

  it("does not change the collection or refetch when DELETE fails", async () => {
    mocks.apiRequest.mockImplementation(async (_path: string, options?: RequestInit) => {
      if (options?.method === "DELETE") throw new Error("denied");
      return {};
    });
    const changed = vi.fn();
    render(<PropertyImageManager propertyId={12} images={images} onImagesChange={changed} />);
    fireEvent.click(screen.getByRole("button", { name: "delete-1" }));
    await waitFor(() => expect(mocks.deleteFailure).toHaveBeenCalled());
    expect(changed).not.toHaveBeenCalled();
    expect(mocks.apiRequest).not.toHaveBeenCalledWith("/owner/properties/12/images");
    expect(screen.getByRole("button", { name: "delete-1" })).toBeTruthy();
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
