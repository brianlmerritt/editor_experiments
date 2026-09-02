export type ProsePatternSignal = 'cadence_monoculture' | 'somatic_repetition';

export interface ProsePatternFinding {
  from: number;
  to: number;
  anchors: Array<{ from: number; to: number }>;
  signal: ProsePatternSignal;
  comment: string;
  confidence: number;
}

interface TextSpan {
  from: number;
  to: number;
  text: string;
}

function wordCount(text: string): number {
  return text.trim() ? text.trim().split(/\s+/u).length : 0;
}

function paragraphSpans(text: string): TextSpan[] {
  const spans: TextSpan[] = [];
  for (const match of text.matchAll(/[^\n]+/gu)) {
    const raw = match[0];
    const leading = raw.search(/\S/u);
    if (leading < 0) continue;
    const content = raw.trimEnd();
    const from = (match.index ?? 0) + leading;
    spans.push({ from, to: (match.index ?? 0) + content.length, text: text.slice(from, (match.index ?? 0) + content.length) });
  }
  return spans;
}

function representativeAnchors(spans: TextSpan[], maximum = 16): Array<{ from: number; to: number }> {
  if (spans.length <= maximum) return spans.map(({ from, to }) => ({ from, to }));
  const indexes = new Set<number>();
  for (let index = 0; index < maximum; index += 1) {
    indexes.add(Math.round(index * (spans.length - 1) / (maximum - 1)));
  }
  return [...indexes].map((index) => ({ from: spans[index].from, to: spans[index].to }));
}

function occurrences(text: string, pattern: RegExp): TextSpan[] {
  return [...text.matchAll(pattern)].map((match) => ({
    from: match.index ?? 0,
    to: (match.index ?? 0) + match[0].length,
    text: match[0]
  }));
}

const somaticFamilies = [
  { name: 'breath/breathing', pattern: /\b(?:breath|breaths|breathe|breathes|breathed|breathing)\b/giu, minimum: 8, minimumPerThousand: 2.5 },
  { name: 'nodding', pattern: /\b(?:nod|nods|nodded|nodding)\b/giu, minimum: 8, minimumPerThousand: 2.5 },
  { name: 'swallowing', pattern: /\b(?:swallow|swallows|swallowed|swallowing)\b/giu, minimum: 6, minimumPerThousand: 1.8 },
  { name: 'heartbeat/pulse', pattern: /\b(?:heartbeat|heartbeats|heart (?:pounded|raced|hammered)|pulse (?:pounded|raced|hammered))\b/giu, minimum: 6, minimumPerThousand: 1.8 }
] as const;

export function detectProsePatterns(text: string, limit = 20): ProsePatternFinding[] {
  const words = wordCount(text);
  if (words < 250) return [];
  const findings: ProsePatternFinding[] = [];
  const paragraphs = paragraphSpans(text);
  const shortParagraphs = paragraphs.filter((paragraph) => wordCount(paragraph.text) <= 5);
  if (paragraphs.length >= 20 && shortParagraphs.length >= 12 && shortParagraphs.length / paragraphs.length >= 0.22) {
    const anchors = representativeAnchors(shortParagraphs);
    findings.push({
      ...anchors[Math.min(2, anchors.length - 1)],
      anchors,
      signal: 'cadence_monoculture',
      comment: `Cadence monoculture — ${shortParagraphs.length} of ${paragraphs.length} non-empty paragraphs contain five words or fewer. The fragments may sharpen individual high-pressure beats, but their document-wide concentration can flatten contrast between action, reflection and recovery.`,
      confidence: 0.84
    });
  }

  for (const family of somaticFamilies) {
    const matches = occurrences(text, family.pattern);
    const rate = matches.length / words * 1000;
    if (matches.length < family.minimum || rate < family.minimumPerThousand) continue;
    const anchors = representativeAnchors(matches);
    findings.push({
      ...anchors[Math.min(2, anchors.length - 1)],
      anchors,
      signal: 'somatic_repetition',
      comment: `Somatic repetition — ${family.name} appears ${matches.length} times (${rate.toFixed(1)} per 1,000 words). Check whether this bodily cue has become the default carrier for different characters or emotional states.`,
      confidence: 0.82
    });
  }
  return findings.slice(0, Math.max(0, limit));
}
