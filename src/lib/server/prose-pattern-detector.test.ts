import { describe, expect, it } from 'vitest';
import { detectProsePatterns } from './prose-pattern-detector';

describe('prose pattern detector', () => {
  it('reports one multi-anchor finding for document-wide fragment density', () => {
    const text = Array.from({ length: 30 }, (_, index) => index % 2 === 0
      ? `Still here ${index}.`
      : `Mara crossed the platform while the last train moved beyond the rain and the station clock continued above her.`).join('\n');
    const finding = detectProsePatterns(text).find((item) => item.signal === 'cadence_monoculture');

    expect(finding?.anchors.length).toBeGreaterThanOrEqual(12);
    expect(finding?.comment).toContain('15 of 30');
  });

  it('reports repeated somatic vocabulary as one distributed multi-anchor pattern', () => {
    const paragraphs = Array.from({ length: 18 }, (_, index) =>
      `Mara watched the platform while the evening train passed beyond the glass and counted each breath ${index} before answering the porter.`);
    const text = paragraphs.join('\n');
    const finding = detectProsePatterns(text).find((item) => item.signal === 'somatic_repetition');

    expect(finding?.anchors).toHaveLength(16);
    expect(finding?.comment).toContain('breath/breathing appears 18 times');
  });

  it('does not turn an isolated physical phrase or short passage into a prose pattern', () => {
    expect(detectProsePatterns('She focused on the weight of the mattress beneath her.')).toEqual([]);
  });
});
