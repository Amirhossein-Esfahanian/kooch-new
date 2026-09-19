import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

vi.mock("react-easy-crop", async () => {
  const React = await import("react");

  return {
    default: ({
      onCropComplete,
    }: {
      onCropComplete: (
        croppedArea: Record<string, number>,
        croppedAreaPixels: Record<string, number>,
      ) => void;
    }) => {
      React.useEffect(() => {
        const area = { x: 0, y: 0, width: 40, height: 30 };
        onCropComplete(area, area);
        // The production cropper publishes this once the crop area is ready.
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, []);

      return <div data-testid="cropper" />;
    },
  };
});

import { SharedUploader } from "@/components/SharedUploader";

const sharedUploaderSourcePath = resolve(
  process.cwd(),
  "components/SharedUploader.tsx",
);

class FakeXMLHttpRequest {
  static requests: FakeXMLHttpRequest[] = [];

  upload: { onprogress: ((event: ProgressEvent) => void) | null } = {
    onprogress: null,
  };
  status = 0;
  responseText = "";
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  body: Document | XMLHttpRequestBodyInit | null = null;

  open = vi.fn();
  setRequestHeader = vi.fn();

  send(body?: Document | XMLHttpRequestBodyInit | null) {
    this.body = body ?? null;
    FakeXMLHttpRequest.requests.push(this);
  }

  respond(status: number, body: Record<string, unknown> = {}) {
    this.status = status;
    this.responseText = JSON.stringify(body);
    this.onload?.();
  }
}

function selectFile(container: HTMLElement, file: File) {
  const input = container.querySelector<HTMLInputElement>('input[type="file"]');
  if (!input) throw new Error("File input was not rendered.");
  fireEvent.change(input, { target: { files: [file] } });
}

describe("SharedUploader automatic upload", () => {
  beforeEach(() => {
    FakeXMLHttpRequest.requests = [];
    vi.stubGlobal("XMLHttpRequest", FakeXMLHttpRequest);
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL: vi.fn(() => "blob:preview"),
      revokeObjectURL: vi.fn(),
    });
    vi.stubGlobal(
      "Image",
      class {
        onload: (() => void) | null = null;
        onerror: (() => void) | null = null;

        set src(_value: string) {
          this.onload?.();
        }
      },
    );
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      drawImage: vi.fn(),
    } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(
      (callback) =>
        callback(new Blob(["cropped-image"], { type: "image/jpeg" })),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it.each([{}, undefined])(
    "selects and independently removes pending files without randomUUID (%j)",
    (cryptoValue) => {
      vi.stubGlobal("crypto", cryptoValue);
      vi.spyOn(Date, "now").mockReturnValue(123);
      const onFilesChange = vi.fn();
      const { container } = render(
        <SharedUploader
          onFilesChange={onFilesChange}
          uploadUrl="/api/upload"
        />,
      );
      const file = new File(["image"], "same.png", {
        type: "image/png",
        lastModified: 123,
      });
      selectFile(container, file);
      selectFile(container, file);
      expect(onFilesChange).toHaveBeenLastCalledWith([file, file]);
      fireEvent.click(screen.getAllByRole("button", { name: "حذف" })[0]);
      expect(onFilesChange).toHaveBeenLastCalledWith([file]);
    },
  );

  it.each(["square", "dropzone"] as const)(
    "forwards the %s browse action to the single-image picker and respects disabled",
    (variant) => {
      const props = {
        variant,
        multiple: false,
        maxFiles: 1,
        uploadUrl: "/api/upload",
        labels: { browseText: "انتخاب تصویر" },
      };
      const { container, rerender } = render(<SharedUploader {...props} />);
      const input =
        container.querySelector<HTMLInputElement>('input[type="file"]')!;
      const click = vi.spyOn(input, "click").mockImplementation(() => {});
      expect(input.accept).toBe("image/jpeg,image/png,image/webp");
      expect(input.multiple).toBe(false);
      expect(input.disabled).toBe(false);
      fireEvent.click(
        screen.getByRole("button", { name: "انتخاب تصویر" }),
      );
      expect(click).toHaveBeenCalledOnce();
      rerender(<SharedUploader {...props} disabled />);
      fireEvent.click(
        screen.getByRole("button", { name: "انتخاب تصویر" }),
      );
      expect(click).toHaveBeenCalledOnce();
    },
  );

  it.each(["image/png", "image/jpeg", "image/webp"])(
    "selects %s with the native UUID path and clears input for reselection",
    (type) => {
      const randomUUID = vi.fn(() => "pending-id");
      vi.stubGlobal("crypto", { randomUUID });
      const onFilesChange = vi.fn();
      const { container } = render(
        <SharedUploader
          multiple={false}
          onFilesChange={onFilesChange}
          uploadUrl="/api/upload"
        />,
      );
      const input =
        container.querySelector<HTMLInputElement>('input[type="file"]')!;
      const resetValue = vi.spyOn(input, "value", "set");
      const file = new File(["image"], "image", { type });
      selectFile(container, file);
      expect(onFilesChange).toHaveBeenLastCalledWith([file]);
      expect(resetValue).toHaveBeenCalledWith("");
      selectFile(container, file);
      expect(randomUUID).toHaveBeenCalledTimes(2);
      expect(onFilesChange).toHaveBeenLastCalledWith([file]);
    },
  );

  it("preserves the failed pending file and retry when a replacement fails validation", async () => {
    const { container } = render(
      <SharedUploader autoUpload multiple={false} uploadUrl="/api/upload" />,
    );
    const file = new File(["image"], "original.png", { type: "image/png" });
    selectFile(container, file);
    FakeXMLHttpRequest.requests[0].respond(500, { message: "upload failed" });
    await screen.findByRole("button", { name: "آپلود" });
    selectFile(
      container,
      new File(["invalid"], "notes.txt", { type: "text/plain" }),
    );
    expect(screen.getByText("original.png")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "آپلود" }));
    expect(FakeXMLHttpRequest.requests).toHaveLength(2);
    expect((FakeXMLHttpRequest.requests[1].body as FormData).get("files")).toBe(
      file,
    );
  });

  it("preserves manual upload when autoUpload is omitted", () => {
    const onUploadSuccess = vi.fn();
    const { container } = render(
      <SharedUploader
        multiple={false}
        onUploadSuccess={onUploadSuccess}
        uploadUrl="/api/upload"
      />,
    );
    const file = new File(["original"], "logo.png", { type: "image/png" });

    selectFile(container, file);
    expect(FakeXMLHttpRequest.requests).toHaveLength(0);

    fireEvent.click(screen.getByRole("button", { name: "آپلود" }));
    expect(FakeXMLHttpRequest.requests).toHaveLength(1);

    FakeXMLHttpRequest.requests[0].respond(200, { url: "/logo.png" });
    expect(onUploadSuccess).toHaveBeenCalledOnce();
  });

  it("uses semantic tokens for shell, muted, primary, and destructive states", () => {
    const { container } = render(
      <SharedUploader
        multiple={false}
        showExistingFiles
        uploadUrl="/api/upload"
      />,
    );

    const shell = container.querySelector("section");
    expect(shell?.classList.contains("border-border")).toBe(true);
    expect(shell?.classList.contains("bg-card")).toBe(true);
    expect(
      screen.getByText("بارگذاری فایل").classList.contains("text-foreground"),
    ).toBe(true);

    const emptyState = screen.getByText("فایلی ثبت نشده است.");
    expect(emptyState.classList.contains("bg-muted")).toBe(true);
    expect(emptyState.classList.contains("text-muted-foreground")).toBe(true);

    const dropzone = screen
      .getByText("فایل‌ها را اینجا رها کنید")
      .closest('[role="button"]');
    if (!dropzone) throw new Error("Dropzone was not rendered.");
    fireEvent.dragEnter(dropzone);
    expect(dropzone.classList.contains("border-primary")).toBe(true);
    expect(dropzone.classList.contains("bg-[var(--theme-primary-soft)]")).toBe(
      true,
    );

    selectFile(
      container,
      new File(["invalid"], "notes.txt", { type: "text/plain" }),
    );
    const error = screen.getByText("فرمت تصویر پشتیبانی نمی‌شود");
    expect(error.classList.contains("bg-[var(--destructive-soft)]")).toBe(true);
    expect(error.classList.contains("text-destructive")).toBe(true);
  });

  it("keeps pending removal and existing square previews on semantic surfaces", () => {
    const pendingView = render(
      <SharedUploader
        enablePreview={false}
        multiple={false}
        uploadUrl="/api/upload"
      />,
    );
    selectFile(
      pendingView.container,
      new File(["image"], "pending.png", { type: "image/png" }),
    );

    const placeholder = screen.getByText("FILE");
    expect(placeholder.classList.contains("bg-muted")).toBe(true);
    expect(
      placeholder.closest("article")?.classList.contains("border-border"),
    ).toBe(true);
    const remove = screen.getByRole("button", { name: "حذف" });
    expect(remove.classList.contains("border-destructive/30")).toBe(true);
    expect(remove.classList.contains("text-destructive")).toBe(true);
    fireEvent.click(remove);
    expect(screen.queryByText("FILE")).toBeNull();

    pendingView.unmount();
    const existingView = render(
      <SharedUploader
        existingFiles={[
          { id: "existing", url: "/existing.png", alt: "تصویر موجود" },
        ]}
        multiple={false}
        showExistingFiles
        uploadUrl="/api/upload"
        variant="square"
      />,
    );
    expect(screen.getByRole("img", { name: "تصویر موجود" })).toBeTruthy();
    expect(
      existingView.container.querySelector(".bg-slate-950\\/20"),
    ).toBeNull();
    expect(screen.getByRole("button", { name: "مشاهده" })).toBeTruthy();
  });

  it("opens a persisted square image by clicking the image without opening the file picker", () => {
    const { container } = render(
      <SharedUploader
        existingFiles={[
          {
            id: "logo",
            url: "/logo.svg",
            name: "لوگوی سایت",
            alt: "لوگوی سایت",
          },
        ]}
        multiple={false}
        showExistingFiles
        uploadUrl="/api/upload"
        variant="square"
      />,
    );

    const input =
      container.querySelector<HTMLInputElement>('input[type="file"]')!;
    const click = vi.spyOn(input, "click").mockImplementation(() => {});

    fireEvent.click(screen.getByRole("button", { name: "مشاهده" }));

    expect(click).not.toHaveBeenCalled();
    const dialog = screen.getByRole("dialog");
    expect(
      within(dialog).getByRole("img", { name: "لوگوی سایت" }),
    ).toBeTruthy();
    expect(
      within(dialog).queryByRole("button", { name: "جایگزینی" }),
    ).toBeNull();
    expect(
      within(dialog).queryByRole("button", { name: "برش تصویر" }),
    ).toBeNull();
  });

  it("keeps the square image clean and exposes management actions only from the corner menu", () => {
    const { container } = render(
      <SharedUploader
        existingFiles={[
          { id: "existing", url: "/existing.png", alt: "تصویر موجود" },
        ]}
        multiple={false}
        showExistingFiles
        uploadUrl="/api/upload"
        variant="square"
      />,
    );

    const input =
      container.querySelector<HTMLInputElement>('input[type="file"]')!;
    const click = vi.spyOn(input, "click").mockImplementation(() => {});

    expect(screen.queryByRole("button", { name: "جایگزینی" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "گزینه‌های تصویر" }));
    expect(click).not.toHaveBeenCalled();

    const menu = screen.getByRole("menu");
    expect(
      within(menu).getByRole("menuitem", { name: "مشاهده" }),
    ).toBeTruthy();
    const replace = within(menu).getByRole("menuitem", { name: "جایگزینی" });
    const crop = within(menu).getByRole("menuitem", { name: "برش تصویر" });
    const remove = within(menu).getByRole("menuitem", { name: "حذف" });
    expect(replace).toBeTruthy();
    expect(crop).toHaveProperty("disabled", true);
    expect(remove).toHaveProperty("disabled", true);

    fireEvent.click(within(menu).getByRole("menuitem", { name: "جایگزینی" }));
    expect(click).toHaveBeenCalledOnce();
    expect(container.querySelector("button button")).toBeNull();
  });

  it("offers replace, crop, and delete in the menu for a local pending raster image", () => {
    const { container } = render(
      <SharedUploader
        enableCrop
        multiple={false}
        uploadUrl="/api/upload"
        variant="square"
      />,
    );

    selectFile(
      container,
      new File(["image"], "photo.png", { type: "image/png" }),
    );

    const input =
      container.querySelector<HTMLInputElement>('input[type="file"]')!;
    const click = vi.spyOn(input, "click").mockImplementation(() => {});

    fireEvent.click(screen.getByRole("button", { name: "گزینه‌های تصویر" }));
    const menu = screen.getByRole("menu");
    expect(
      within(menu).getByRole("menuitem", { name: "جایگزینی" }),
    ).toBeTruthy();
    expect(
      within(menu).getByRole("menuitem", { name: "برش تصویر" }),
    ).toBeTruthy();
    expect(
      within(menu).getByRole("menuitem", { name: "حذف" }),
    ).toBeTruthy();

    fireEvent.click(within(menu).getByRole("menuitem", { name: "جایگزینی" }));
    expect(click).toHaveBeenCalledOnce();
    expect(container.querySelectorAll('input[type="file"]')).toHaveLength(1);
  });

  it("previews SVG files by clicking the image and disables crop in the menu", () => {
    const { container } = render(
      <SharedUploader
        accept={["image/svg+xml"]}
        enableCrop
        multiple={false}
        uploadUrl="/api/upload"
        variant="square"
      />,
    );

    selectFile(
      container,
      new File(["<svg></svg>"], "mark.svg", { type: "image/svg+xml" }),
    );

    fireEvent.click(screen.getByRole("button", { name: "گزینه‌های تصویر" }));
    const menu = screen.getByRole("menu");
    const crop = within(menu).getByRole("menuitem", { name: "برش تصویر" });
    expect(crop).toHaveProperty("disabled", true);
    expect(
      within(menu).getByRole("menuitem", { name: "جایگزینی" }),
    ).toBeTruthy();
    expect(
      within(menu).getByRole("menuitem", { name: "حذف" }),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "مشاهده" }));
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getAllByRole("img", { name: "mark.svg" })).toHaveLength(2);
  });

  it("deletes a local pending square image from the contextual menu", () => {
    const { container } = render(
      <SharedUploader
        multiple={false}
        uploadUrl="/api/upload"
        variant="square"
      />,
    );

    selectFile(
      container,
      new File(["image"], "pending.png", { type: "image/png" }),
    );

    fireEvent.click(screen.getByRole("button", { name: "گزینه‌های تصویر" }));
    const menu = screen.getByRole("menu");
    const remove = within(menu).getByRole("menuitem", { name: "حذف" });
    expect(remove.classList.contains("text-destructive")).toBe(true);
    fireEvent.click(remove);
    expect(screen.queryByRole("img", { name: "pending.png" })).toBeNull();
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(FakeXMLHttpRequest.requests).toHaveLength(0);
  });

  it("uses the existing-file delete callback when the consumer explicitly enables it", () => {
    const onDeleteExisting = vi.fn();
    render(
      <SharedUploader
        allowDeleteExisting
        existingFiles={[
          { id: "persisted", url: "/persisted.png", alt: "تصویر ذخیره‌شده" },
        ]}
        multiple={false}
        onDeleteExisting={onDeleteExisting}
        showExistingFiles
        uploadUrl="/api/upload"
        variant="square"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "گزینه‌های تصویر" }));
    const menu = screen.getByRole("menu");
    fireEvent.click(within(menu).getByRole("menuitem", { name: "حذف" }));
    expect(onDeleteExisting).not.toHaveBeenCalled();
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "حذف تصویر" }));
    expect(onDeleteExisting).toHaveBeenCalledOnce();
    expect(onDeleteExisting).toHaveBeenCalledWith("persisted");
  });

  it("shows persisted delete disabled without an explicit delete contract", () => {
    render(
      <SharedUploader
        existingFiles={[
          { id: "persisted", url: "/persisted.png", alt: "تصویر ذخیره‌شده" },
        ]}
        multiple={false}
        showExistingFiles
        uploadUrl="/api/upload"
        variant="square"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "گزینه‌های تصویر" }));
    const menu = screen.getByRole("menu");
    expect(
      within(menu).getByRole("menuitem", { name: "حذف" }),
    ).toHaveProperty("disabled", true);
  });

  it("keeps persisted preview clickable while disabling mutations when disabled", () => {
    const { container } = render(
      <SharedUploader
        disabled
        enableCrop
        existingFiles={[
          { id: "existing", url: "/existing.png", alt: "تصویر موجود" },
        ]}
        multiple={false}
        showExistingFiles
        uploadUrl="/api/upload"
        variant="square"
      />,
    );

    const input =
      container.querySelector<HTMLInputElement>('input[type="file"]')!;
    expect(input.disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "گزینه‌های تصویر" }));
    expect(screen.queryByRole("menuitem", { name: "جایگزینی" })).toBeNull();
    expect(screen.getByRole("menuitem", { name: "حذف" })).toHaveProperty("disabled", true);
    expect(screen.getByRole("menuitem", { name: "برش تصویر" })).toHaveProperty("disabled", true);

    fireEvent.click(screen.getByRole("button", { name: "مشاهده" }));
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("shows a simple plus and Add photo when the square uploader is empty", () => {
    render(
      <SharedUploader
        multiple={false}
        uploadUrl="/api/upload"
        variant="square"
      />,
    );

    expect(screen.getByText("+")).toBeTruthy();
    expect(screen.getByText("Add photo")).toBeTruthy();
  });

  it("uses semantic palette classes and only the requested image-action SVGs", () => {
    const source = readFileSync(sharedUploaderSourcePath, "utf8");
    const removedClasses = [
      "border-slate-200",
      "border-slate-300",
      "bg-white/90",
      "bg-slate-50",
      "bg-slate-100",
      "text-slate-950",
      "text-slate-800",
      "text-slate-700",
      "text-slate-500",
      "text-slate-400",
      "border-blue-500",
      "border-blue-300",
      "border-blue-200",
      "bg-blue-600",
      "bg-blue-50",
      "text-blue-700",
      "border-red-200",
      "bg-red-50",
      "text-red-700",
    ];

    removedClasses.forEach((className) =>
      expect(source).not.toContain(className),
    );
    expect(source).not.toContain("bg-slate-950/20");
    expect(source).toContain("bg-slate-900");
    [
      "/svgs/crop-alt.svg",
      "/svgs/repeat-3.svg",
      "/svgs/ellipsis-v.svg",
      "/svgs/image-circle-xmark.svg",
    ].forEach((iconPath) => expect(source).toContain(iconPath));
    expect(source).toContain("/svgs/eye-2.svg");
  });

  it("auto-uploads one accepted file exactly once and keeps the success callback", () => {
    const onUploadSuccess = vi.fn();
    const { container } = render(
      <SharedUploader
        autoUpload
        multiple={false}
        onUploadSuccess={onUploadSuccess}
        uploadUrl="/api/upload"
      />,
    );

    selectFile(
      container,
      new File(["logo"], "logo.png", { type: "image/png" }),
    );

    expect(FakeXMLHttpRequest.requests).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "آپلود" })).toBeNull();
    expect(
      (
        screen.getByRole("button", {
          name: "در حال آپلود...",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);

    FakeXMLHttpRequest.requests[0].respond(200, { url: "/new-logo.png" });
    expect(onUploadSuccess).toHaveBeenCalledWith({ url: "/new-logo.png" });
    expect(FakeXMLHttpRequest.requests).toHaveLength(1);
  });

  it("does not upload invalid files", () => {
    const { container } = render(
      <SharedUploader autoUpload multiple={false} uploadUrl="/api/upload" />,
    );

    selectFile(
      container,
      new File(["not-an-image"], "notes.txt", { type: "text/plain" }),
    );

    expect(FakeXMLHttpRequest.requests).toHaveLength(0);
    expect(screen.queryByRole("button", { name: "آپلود" })).toBeNull();
  });

  it("keeps a failed automatic upload available for manual retry", async () => {
    const { container } = render(
      <SharedUploader autoUpload multiple={false} uploadUrl="/api/upload" />,
    );
    selectFile(
      container,
      new File(["logo"], "logo.png", { type: "image/png" }),
    );

    FakeXMLHttpRequest.requests[0].respond(500, { message: "upload failed" });

    const retry = await screen.findByRole("button", { name: "آپلود" });
    fireEvent.click(retry);
    expect(FakeXMLHttpRequest.requests).toHaveLength(2);
  });

  it("waits for crop confirmation and uploads the cropped file once", async () => {
    const { container } = render(
      <SharedUploader
        autoUpload
        enableCrop
        multiple={false}
        uploadUrl="/api/upload"
        variant="square"
      />,
    );
    const original = new File(["original-image"], "hero.jpg", {
      type: "image/jpeg",
    });

    selectFile(container, original);
    expect(FakeXMLHttpRequest.requests).toHaveLength(0);
    const cropper = await screen.findByTestId("cropper");
    expect(cropper.parentElement?.classList.contains("bg-slate-900")).toBe(
      true,
    );

    fireEvent.click(screen.getByRole("button", { name: "تایید برش" }));
    await waitFor(() => expect(FakeXMLHttpRequest.requests).toHaveLength(1));

    const formData = FakeXMLHttpRequest.requests[0].body as FormData;
    const uploaded = formData.get("files") as File;
    expect(uploaded).toBeInstanceOf(File);
    expect(uploaded).not.toBe(original);
    expect(uploaded.name).toBe(original.name);
    expect(uploaded.size).toBe("cropped-image".length);
  });

  it("does not upload when crop is canceled", async () => {
    const { container } = render(
      <SharedUploader
        autoUpload
        enableCrop
        multiple={false}
        uploadUrl="/api/upload"
        variant="square"
      />,
    );

    selectFile(
      container,
      new File(["hero"], "hero.jpg", { type: "image/jpeg" }),
    );
    await screen.findByTestId("cropper");
    fireEvent.click(screen.getByRole("button", { name: "انصراف" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(FakeXMLHttpRequest.requests).toHaveLength(0);
  });
});
