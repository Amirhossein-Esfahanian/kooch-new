import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PropertyImageResponse } from "@/lib/owner-api";
import { useState } from "react";
import type { ReactNode } from "react";

const mocks = vi.hoisted(() => ({
  apiRequest: vi.fn(),
  deleteFailure: vi.fn(),
  getToken: vi.fn(),
  sharedUploaderProps: vi.fn(),
}));

vi.mock("@/lib/owner-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/owner-api")>();
  return {
    ...actual,
    apiRequest: mocks.apiRequest,
    getToken: mocks.getToken,
  };
});

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

vi.mock("@/components/SharedUploader", () => ({
  SharedUploader: (props: Record<string, unknown>) => {
    mocks.sharedUploaderProps(props);
    return <div data-testid="shared-uploader" />;
  },
}));

vi.mock("@/components/MediaGallery", () => ({
  MediaGallery: ({
    addControl,
    constraints,
    disabled,
    items,
    totalItemCount,
    onDelete,
  }: {
    addControl?: ReactNode;
    constraints: {
      maxFileSizeMb: number;
      minWidth: number;
      minHeight: number;
      maxImages: number;
    };
    disabled?: boolean;
    items: (PropertyImageResponse & { isMain: boolean })[];
    totalItemCount: number;
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
      {addControl}
      {items.map((item) => (
        <span
          data-main={item.isMain}
          data-testid="gallery-image"
          key={item.id}
        >
          {item.id}
          <button
            onClick={() => void onDelete(item).catch(mocks.deleteFailure)}
          >
            {`delete-${item.id}`}
          </button>
        </span>
      ))}
    </div>
  ),
}));


import { PropertyImageManager } from "@/components/owner/PropertyImageManager";

describe("PropertyImageManager operational settings", () => {
  afterEach(() => vi.unstubAllGlobals());
  beforeEach(() => {
    mocks.apiRequest.mockReset();
    mocks.deleteFailure.mockReset();
    mocks.getToken.mockReset();
    mocks.getToken.mockReturnValue("test-token");
    mocks.sharedUploaderProps.mockReset();
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

  it.each([
    [undefined, { tag: "other", roomTypeId: undefined }],
    [20, { tag: "room", roomTypeId: 20 }],
  ] as const)(
    "configures SharedUploader metadata for RoomType %s",
    async (roomTypeId, expected) => {
      mocks.apiRequest.mockResolvedValue({});
      const onImagesChange = vi.fn();

      render(
        <PropertyImageManager
          fixedRoomTypeId={roomTypeId}
          images={images}
          onImagesChange={onImagesChange}
          propertyId={12}
        />,
      );

      await waitFor(() => expect(mocks.sharedUploaderProps).toHaveBeenCalled());
      const uploaderCalls = mocks.sharedUploaderProps.mock.calls;
      const props = uploaderCalls[uploaderCalls.length - 1][0] as {
        autoUpload: boolean;
        embedded: boolean;
        fieldName: string;
        headers?: Record<string, string>;
        maxFiles: number;
        metadata: Record<string, unknown>;
        multiple: boolean;
        onUploadSuccess: (payload: PropertyImageResponse[]) => void;
        uploadUrl: string;
        variant: string;
      };

      expect(props.uploadUrl).toBe(
        "/api/backend/owner/properties/12/images/upload",
      );
      expect(props.autoUpload).toBe(true);
      expect(props.embedded).toBe(true);
      expect(props.fieldName).toBe("files");
      expect(props.multiple).toBe(true);
      expect(props.variant).toBe("square");
      expect(props.headers).toEqual({
        Authorization: "Bearer test-token",
      });
      expect(props.maxFiles).toBe(25);
      expect(props.metadata).toEqual({
        tag: expected.tag,
        caption: "",
        altText: "",
        isCover: false,
        ...(expected.roomTypeId
          ? { roomTypeId: expected.roomTypeId }
          : {}),
      });

      const uploaded: PropertyImageResponse = {
        ...images[0],
        id: 99,
        roomTypeId: roomTypeId ?? null,
        isCover: roomTypeId === undefined,
        sortOrder: 99,
        url: "/images/99.png",
      };
      props.onUploadSuccess([uploaded]);

      expect(onImagesChange).toHaveBeenCalledWith([...images, uploaded]);
    },
  );

  it("validates new-image dimensions through the SharedUploader validator", async () => {
    mocks.apiRequest.mockResolvedValue({});
    const createObjectURL = vi.fn(() => "blob:dimension-test");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL,
      revokeObjectURL,
    });

    let naturalWidth = 1200;
    let naturalHeight = 900;
    vi.stubGlobal(
      "Image",
      class {
        onload: (() => void) | null = null;
        onerror: (() => void) | null = null;

        get naturalWidth() {
          return naturalWidth;
        }

        get naturalHeight() {
          return naturalHeight;
        }

        set src(_value: string) {
          this.onload?.();
        }
      },
    );

    render(
      <PropertyImageManager
        images={images}
        onImagesChange={vi.fn()}
        propertyId={12}
      />,
    );

    await waitFor(() => expect(mocks.sharedUploaderProps).toHaveBeenCalled());
    const uploaderCalls = mocks.sharedUploaderProps.mock.calls;
    const props = uploaderCalls[uploaderCalls.length - 1][0] as {
      validateFile: (file: File) => Promise<string | null>;
    };
    const file = new File(["image"], "photo.png", { type: "image/png" });

    expect(await props.validateFile(file)).toBeNull();

    naturalWidth = 799;
    naturalHeight = 900;
    expect(await props.validateFile(file)).toBe("ابعاد تصویر مناسب نیست");

    naturalWidth = 1200;
    naturalHeight = 599;
    expect(await props.validateFile(file)).toBe("ابعاد تصویر مناسب نیست");

    expect(createObjectURL).toHaveBeenCalledTimes(3);
    expect(revokeObjectURL).toHaveBeenCalledTimes(3);
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
    const uploaderCalls = mocks.sharedUploaderProps.mock.calls;
    const uploaderProps = uploaderCalls[uploaderCalls.length - 1][0] as {
      maxFiles: number;
    };
    expect(uploaderProps.maxFiles).toBe(40);
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
    const uploaderCalls = mocks.sharedUploaderProps.mock.calls;
    const uploaderProps = uploaderCalls[uploaderCalls.length - 1][0] as {
      disabled: boolean;
    };
    expect(uploaderProps.disabled).toBe(true);
  });
});
