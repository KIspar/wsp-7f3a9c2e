type Size = { width: number; height: number };
export const imagePadding = 24;
export function fitImageScale(image: Size, viewport: Size) {
  return Math.max(.01, Math.min((viewport.width - imagePadding * 2) / image.width, (viewport.height - imagePadding * 2) / image.height, 4));
}

/** Preserve the image point underneath the cursor while its layout size changes. */
export function zoomImageViewport(image: Size, viewport: Size, scroll: { left: number; top: number }, point: { x: number; y: number }, from: number, to: number) {
  const offset = (length: number, available: number, scale: number) => Math.max(imagePadding, (available - length * scale) / 2);
  const axis = (length: number, available: number, position: number, pointer: number) => {
    const coordinate = (position + pointer - offset(length, available, from)) / from;
    const next = offset(length, available, to) + coordinate * to - pointer;
    return Math.max(0, Math.min(Math.max(0, length * to + imagePadding * 2 - available), next));
  };
  return { left: axis(image.width, viewport.width, scroll.left, point.x), top: axis(image.height, viewport.height, scroll.top, point.y) };
}
