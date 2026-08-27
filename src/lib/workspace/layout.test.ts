import { describe, expect, it } from 'vitest';
import { clampEditorZoom, clampInputsWidth, clampNavigatorWidth, maxInputsWidth, maxNavigatorWidth } from './layout';

describe('workbench layout', () => {
  it('keeps the Navigator between 250 pixels and half the viewport', () => {
    expect(clampNavigatorWidth(100, 2000)).toBe(250);
    expect(clampNavigatorWidth(640, 2000)).toBe(640);
    expect(clampNavigatorWidth(1400, 2000)).toBe(1000);
    expect(maxNavigatorWidth(2000)).toBe(1000);
  });

  it('lets the minimum win when a very narrow viewport cannot satisfy both limits', () => {
    expect(clampNavigatorWidth(400, 420)).toBe(250);
  });

  it('keeps the Inputs panel between 300 pixels and half the viewport', () => {
    expect(clampInputsWidth(100, 2000)).toBe(300);
    expect(clampInputsWidth(640, 2000)).toBe(640);
    expect(clampInputsWidth(1400, 2000)).toBe(1000);
    expect(maxInputsWidth(2000)).toBe(1000);
  });

  it('keeps editor zoom on five-percent steps within its view-only range', () => {
    expect(clampEditorZoom(42)).toBe(75);
    expect(clampEditorZoom(113)).toBe(115);
    expect(clampEditorZoom(250)).toBe(160);
  });
});
