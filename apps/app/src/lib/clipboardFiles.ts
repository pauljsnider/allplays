type ClipboardItemLike = {
  kind?: string;
  type?: string;
  getAsFile?: () => File | null;
};

type ClipboardDataLike = {
  items?: ArrayLike<ClipboardItemLike> | null;
  files?: ArrayLike<File> | null;
};

export function getPastedImageFiles(clipboardData: ClipboardDataLike | null | undefined): File[] {
  const itemFiles = Array.from(clipboardData?.items || [])
    .filter((item) => item.kind === 'file' && String(item.type || '').startsWith('image/'))
    .map((item) => item.getAsFile?.() || null)
    .filter((file): file is File => Boolean(file));

  if (itemFiles.length) return itemFiles;

  return Array.from(clipboardData?.files || [])
    .filter((file) => String(file.type || '').startsWith('image/'));
}
