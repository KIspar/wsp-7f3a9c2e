/** Return only static image files carried by a clipboard event. */
export function pastedImageFiles(event: { clipboardData?: DataTransfer | null }): File[] {
  const clipboard = event.clipboardData;
  const files = Array.from(clipboard?.files || []);
  if (!files.length) for (const item of Array.from(clipboard?.items || [])) {
    if (item.kind === 'file') {
      const file = item.getAsFile();
      if (file) files.push(file);
    }
  }
  return files.filter(file =>
    ['image/jpeg', 'image/png', 'image/webp'].includes(file.type),
  );
}

/** Handle an image paste without interrupting ordinary text paste. */
export function uploadPastedImages(
  event: { clipboardData?: DataTransfer | null; preventDefault: () => void; stopPropagation?: () => void },
  upload: (files: File[]) => void | Promise<void>,
) {
  const files = pastedImageFiles(event);
  if (!files.length) return;
  event.preventDefault();
  // Portalled dialogs still bubble through their React parents. Consume once.
  event.stopPropagation?.();
  void upload(files);
}
