export interface ImageDimensions {
  width: number;
  height: number;
}

export async function readImageDimensions(file: File): Promise<ImageDimensions> {
  const url = URL.createObjectURL(file);

  try {
    return await new Promise<ImageDimensions>((resolve, reject) => {
      const image = new window.Image();
      image.onload = () =>
        resolve({
          width: image.naturalWidth,
          height: image.naturalHeight,
        });
      image.onerror = () =>
        reject(new Error("فرمت تصویر پشتیبانی نمی‌شود"));
      image.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}
