import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ComponentProps, ImgHTMLAttributes } from "react";
import { toast } from "sonner";

vi.mock("sonner", () => ({ toast: { error: vi.fn(), info: vi.fn(), success: vi.fn() } }));

vi.mock("next/image", () => ({
  default: ({ fill: _fill, priority: _priority, quality: _quality, unoptimized: _unoptimized, ...props }: ImgHTMLAttributes<HTMLImageElement> & Record<string, unknown>) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img {...props} />
  ),
}));

vi.mock("react-easy-crop", () => ({
  default: () => <div data-testid="cropper" />,
}));

import { MediaGallery, MediaGalleryItem } from "@/components/MediaGallery";

const items: MediaGalleryItem[] = [
  { id: 1, url: "/courtyard.jpg", alt: "حیاط اقامتگاه", isMain: true },
  { id: 2, url: "/roof.jpg", alt: "بام اقامتگاه" },
];

function renderGallery(overrides: Partial<ComponentProps<typeof MediaGallery<MediaGalleryItem>>> = {}) {
  const props = {
    items,
    mode: "property" as const,
    onAdd: vi.fn(),
    onCrop: vi.fn(),
    onDelete: vi.fn(),
    onSetMain: vi.fn(),
    ...overrides,
  };

  return { ...render(<MediaGallery {...props} />), props };
}

describe("MediaGallery property image workflow", () => {
  beforeEach(() => {
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
  });

  it("opens a visible KoochDialog preview and navigates between property images", async () => {
    renderGallery();

    fireEvent.click(screen.getAllByRole("button", { name: "نمایش تصویر" })[0]);

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("img", { name: "حیاط اقامتگاه" })).toBeTruthy();

    fireEvent.click(within(dialog).getByRole("button", { name: "تصویر بعدی" }));
    expect(within(dialog).getByRole("img", { name: "بام اقامتگاه" })).toBeTruthy();

    fireEvent.click(within(dialog).getByRole("button", { name: "تصویر قبلی" }));
    expect(within(dialog).getByRole("img", { name: "حیاط اقامتگاه" })).toBeTruthy();
  });

  it("closes the preview with Escape and the KoochDialog backdrop", async () => {
    renderGallery();
    fireEvent.click(screen.getAllByRole("button", { name: "نمایش تصویر" })[0]);
    await screen.findByRole("dialog");

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    fireEvent.click(screen.getAllByRole("button", { name: "نمایش تصویر" })[0]);
    await screen.findByRole("dialog");
    fireEvent.click(screen.getByRole("button", { name: "بستن دیالوگ" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("renders addControl as the first gallery cell and omits the native file input", () => {
    const { container } = renderGallery({
      addControl: <div data-testid="custom-add-control">custom add</div>,
    });

    const control = screen.getByTestId("custom-add-control");
    expect(control.parentElement?.firstElementChild).toBe(control);
    expect(container.querySelector('input[type="file"]')).toBeNull();
    expect(screen.getAllByRole("button", { name: "نمایش تصویر" })).toHaveLength(
      items.length,
    );
  });

  it("keeps the native add-photo fallback when addControl is omitted", async () => {
    const onAdd = vi.fn();
    const { container } = renderGallery({ onAdd });
    const input = container.querySelector<HTMLInputElement>(
      'input[type="file"]',
    );
    expect(input).toBeTruthy();

    const createObjectUrl = vi.fn(() => "blob:test-image");
    const revokeObjectUrl = vi.fn();
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL: createObjectUrl,
      revokeObjectURL: revokeObjectUrl,
    });
    vi.stubGlobal(
      "Image",
      class {
        naturalWidth = 1200;
        naturalHeight = 900;
        onload: (() => void) | null = null;
        onerror: (() => void) | null = null;

        set src(_value: string) {
          this.onload?.();
        }
      },
    );

    const file = new File(["image"], "fallback.jpg", {
      type: "image/jpeg",
    });
    fireEvent.change(input!, { target: { files: [file] } });
    await waitFor(() => expect(onAdd).toHaveBeenCalledWith([file]));
  });

  it("keeps upload and remove actions connected to the shared gallery", async () => {
    const onAdd = vi.fn();
    const onDelete = vi.fn();
    const { container } = renderGallery({ onAdd, onDelete });
    const createObjectUrl = vi.fn(() => "blob:test-image");
    const revokeObjectUrl = vi.fn();
    vi.stubGlobal("URL", { ...URL, createObjectURL: createObjectUrl, revokeObjectURL: revokeObjectUrl });
    vi.stubGlobal("Image", class {
      naturalWidth = 1200;
      naturalHeight = 900;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;

      set src(_value: string) {
        this.onload?.();
      }
    });

    const file = new File(["image"], "new-room.jpg", { type: "image/jpeg" });
    fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [file] } });
    await waitFor(() => expect(onAdd).toHaveBeenCalledWith([file]));

    fireEvent.click(screen.getAllByRole("button", { name: "گزینه‌های تصویر" })[0]);
    fireEvent.click(screen.getByRole("button", { name: "حذف" }));
    expect(onDelete).not.toHaveBeenCalled();
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "حذف تصویر" }));
    await waitFor(() => expect(onDelete).toHaveBeenCalledWith(items[0]));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
  });

  it("marks the property cover and exposes the current cover/crop/delete menu", () => {
    const { props } = renderGallery();
    expect(screen.getByText("عکس اصلی")).toBeTruthy();
    fireEvent.click(screen.getAllByRole("button", { name: "گزینه‌های تصویر" })[1]);
    expect(screen.getByRole("button", { name: "برش تصویر" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "حذف" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "جایگزینی" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "تعیین به عنوان عکس کاور" }));
    expect(props.onSetMain).toHaveBeenCalledWith(items[1]);
  });

  it("labels the first RoomType image without exposing an independent cover action", () => {
    renderGallery({ mode: "room" });
    expect(screen.getAllByText("عکس اول")).toHaveLength(1);
    expect(screen.queryByText("عکس اصلی")).toBeNull();
    fireEvent.click(screen.getAllByRole("button", { name: "گزینه‌های تصویر" })[0]);
    expect(screen.queryByRole("button", { name: "تعیین به عنوان عکس کاور" })).toBeNull();
    expect(screen.getByRole("button", { name: "برش تصویر" })).toBeTruthy();
  });

  it("opens the existing preview through مشاهده without menu bubbling", () => {
    renderGallery();
    fireEvent.click(screen.getAllByRole("button", { name: "گزینه‌های تصویر" })[1]);
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "مشاهده" }));
    expect(within(screen.getByRole("dialog")).getByRole("img", { name: "بام اقامتگاه" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "حذف" })).toBeNull();
  });

  it.each([
    ["property", items, 0, "حذف تصویر اصلی"],
    ["property", items, 1, "حذف تصویر"],
    ["property", [items[0]], 0, "حذف تصویر"],
    ["room", items, 0, "حذف تصویر"],
  ] as const)("uses scoped confirmation for %s / %s / %s", (mode, collection, index, title) => {
    const { props } = renderGallery({ mode, items: [...collection], totalItemCount: 99 });
    fireEvent.click(screen.getAllByRole("button", { name: "گزینه‌های تصویر" })[index]);
    fireEvent.click(screen.getByRole("button", { name: "حذف" }));
    const dialog = screen.getByRole("alertdialog", { name: title });
    expect(screen.queryByRole("button", { name: "برش تصویر" })).toBeNull();
    expect(props.onDelete).not.toHaveBeenCalled();
    expect(dialog.textContent?.includes("تصویر بعدی")).toBe(title === "حذف تصویر اصلی");
    fireEvent.click(within(dialog).getByRole("button", { name: "انصراف" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(props.onDelete).not.toHaveBeenCalled();
    expect(screen.getAllByRole("button", { name: "نمایش تصویر" })).toHaveLength(collection.length);
  });

  it("prevents repeated confirm and keeps the image after failure, allowing retry", async () => {
    let reject!: (error: Error) => void;
    const onDelete = vi.fn().mockImplementationOnce(() => new Promise((_, fail) => { reject = fail; })).mockResolvedValue(undefined);
    renderGallery({ onDelete });
    const open = () => {
      fireEvent.click(screen.getAllByRole("button", { name: "گزینه‌های تصویر" })[1]);
      fireEvent.click(screen.getByRole("button", { name: "حذف" }));
      return within(screen.getByRole("alertdialog")).getByRole("button", { name: "حذف تصویر" });
    };
    const confirm = open();
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(confirm).toHaveProperty("disabled", true);
    await act(async () => reject(new Error("delete failed")));
    expect(toast.error).toHaveBeenCalledWith("delete failed", { id: "media-gallery-error" });
    expect(screen.getAllByRole("button", { name: "نمایش تصویر" })).toHaveLength(2);
    fireEvent.click(open());
    await waitFor(() => expect(onDelete).toHaveBeenCalledTimes(2));
  });

  it("still opens the existing crop dialog", () => {
    renderGallery();
    fireEvent.click(screen.getAllByRole("button", { name: "گزینه‌های تصویر" })[1]);
    fireEvent.click(screen.getByRole("button", { name: "برش تصویر" }));
    expect(screen.getByTestId("cropper")).toBeTruthy();
  });

  it("previews an image added to the current gallery items", async () => {
    const view = renderGallery();
    view.rerender(
      <MediaGallery
        {...view.props}
        items={[...items, { id: 3, url: "/fresh.jpg", alt: "تصویر تازه بارگذاری‌شده" }]}
      />,
    );

    fireEvent.click(screen.getAllByRole("button", { name: "نمایش تصویر" })[2]);
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("img", { name: "تصویر تازه بارگذاری‌شده" })).toBeTruthy();
  });
});
