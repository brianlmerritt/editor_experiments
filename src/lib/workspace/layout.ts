export const MIN_NAVIGATOR_WIDTH = 250;
export const DEFAULT_NAVIGATOR_WIDTH = 280;
export const MIN_EDITOR_ZOOM = 75;
export const MAX_EDITOR_ZOOM = 160;
export const DEFAULT_EDITOR_ZOOM = 100;

export function maxNavigatorWidth(viewportWidth: number): number {
  return Math.max(MIN_NAVIGATOR_WIDTH, Math.floor(viewportWidth * 0.5));
}

export function clampNavigatorWidth(width: number, viewportWidth: number): number {
  return Math.min(maxNavigatorWidth(viewportWidth), Math.max(MIN_NAVIGATOR_WIDTH, Math.round(width)));
}

export function clampEditorZoom(zoom: number): number {
  return Math.min(MAX_EDITOR_ZOOM, Math.max(MIN_EDITOR_ZOOM, Math.round(zoom / 5) * 5));
}
