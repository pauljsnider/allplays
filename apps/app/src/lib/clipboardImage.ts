type ClipboardImageItem = {
  type?: string;
  getAsFile?: () => File | null;
};

type ClipboardImageData = {
  items?: ArrayLike<ClipboardImageItem>;
  files?: ArrayLike<File>;
};

type ClipboardImagePasteEvent = {
  clipboardData?: ClipboardImageData;
  preventDefault: () => void;
};

function isImageFile(file: File | null | undefined) {
  return Boolean(
    file &&
    String(file.type || '')
      .toLowerCase()
      .startsWith('image/')
  );
}

export function getClipboardImageFile(clipboardData?: ClipboardImageData | null): File | null {
  const imageFromItems = Array.from(clipboardData?.items || [])
    .map((item) => {
      if (
        !String(item?.type || '')
          .toLowerCase()
          .startsWith('image/')
      )
        return null;
      return typeof item.getAsFile === 'function' ? item.getAsFile() : null;
    })
    .find(isImageFile);

  if (imageFromItems) return imageFromItems;
  return Array.from(clipboardData?.files || []).find(isImageFile) || null;
}

export function capturePastedImage(event: ClipboardImagePasteEvent, onImage: (file: File) => void): boolean {
  const file = getClipboardImageFile(event.clipboardData);
  if (!file) return false;

  event.preventDefault();
  onImage(file);
  return true;
}
