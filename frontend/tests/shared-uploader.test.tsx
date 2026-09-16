import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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
      (callback) => callback(new Blob(["cropped-image"], { type: "image/jpeg" })),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
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
    await screen.findByTestId("cropper");

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
