export type AITellSignal =
  | 'stock_word'
  | 'stock_phrase'
  | 'suspicious_vocabulary_cluster'
  | 'rhetorical_formula'
  | 'fiction_cliche'
  | 'dangling_significance'
  | 'unnamed_authority'
  | 'repeated_transition'
  | 'repeated_negative_assertion'
  | 'catalogued_thought'
  | 'section_break_crutch'
  | 'hedge_cluster'
  | 'repeated_sentence_opening'
  | 'dash_density';

export interface AITellFinding {
  from: number;
  to: number;
  anchors?: Array<{ from: number; to: number }>;
  signal: AITellSignal;
  comment: string;
  confidence: number;
}

interface PatternRule {
  signal: AITellSignal;
  pattern: RegExp;
  comment: string;
  confidence: number;
}

function namedComment(name: string, guidance: string): string {
  return `${name} — ${guidance}`;
}

const patternRules: PatternRule[] = [
  {
    signal: 'stock_word',
    pattern: /\b(?:delv(?:e|es|ed|ing)|utiliz(?:e|es|ed|ing)|leverag(?:e|es|ed|ing)|facilitat(?:e|es|ed|ing)|elucidat(?:e|es|ed|ing)|embark(?:s|ed|ing)?|endeavou?r(?:s|ed|ing)?|encompass(?:es|ed|ing)?|multifaceted|paradigms?|synerg(?:y|ies|ize|izes|ized|izing)|holistic|cataly(?:st|sts|ze|zes|zed|zing)|juxtapos(?:e|es|ed|ing)|myriad|plethora)\b/giu,
    comment: namedComment('Stock vocabulary', 'This word is overrepresented in generic generated prose. Keep it only when it is the precise, natural word for this voice and subject.'),
    confidence: 0.78
  },
  {
    signal: 'stock_phrase',
    pattern: /\bit(?:'s| is) (?:(?:worth|important) (?:noting|remembering)|important to note) that\b/giu,
    comment: namedComment('Importance warning', 'The prefatory phrase delays the point. Test the sentence with the substantive claim first.'),
    confidence: 0.95
  },
  {
    signal: 'stock_phrase',
    pattern: /\b(?:importantly|notably|interestingly),/giu,
    comment: namedComment('Importance label', 'The adverb announces the reader’s reaction instead of earning it through the sentence.'),
    confidence: 0.82
  },
  {
    signal: 'stock_phrase',
    pattern: /\blet(?:'s| us) (?:dive|delve|explore)(?: into)?(?: the fascinating (?:world|realm) of)?\b/giu,
    comment: namedComment('Fake invitation', 'This guided-tour language postpones the subject. Begin with the actual material.'),
    confidence: 0.94
  },
  {
    signal: 'stock_phrase',
    pattern: /\bin (?:this|the following) (?:article|guide|section|chapter),? (?:we (?:will|shall)|you(?:'ll| will))\b/giu,
    comment: namedComment('Content announcement', 'The heading or following content should make this announcement unnecessary.'),
    confidence: 0.91
  },
  {
    signal: 'stock_phrase',
    pattern: /\b(?:as we can see|as mentioned earlier|it goes without saying|without further ado|at the end of the day|when it comes to|one might argue that|it could be suggested that|this begs the question)\b/giu,
    comment: namedComment('Empty framing', 'This frame contributes little information. State the observation, reference, or argument directly.'),
    confidence: 0.88
  },
  {
    signal: 'stock_phrase',
    pattern: /\b(?:in conclusion|to summarize|in summary),?/giu,
    comment: namedComment('Conclusion announcement', 'The reader already knows the section is ending. Let the actual final point carry the close.'),
    confidence: 0.94
  },
  {
    signal: 'stock_phrase',
    pattern: /\bin today(?:'s|’s) (?:fast-paced|digital|modern)(?: world| landscape| environment)?\b/giu,
    comment: namedComment('Stock opener', 'This generic frame could introduce almost any subject. Cut to the particular pressure or condition.'),
    confidence: 0.96
  },
  {
    signal: 'stock_phrase',
    pattern: /\bat (?:its|the) core\b/giu,
    comment: namedComment('Hollow centre', 'This often introduces a truism. Check whether the following sentence contains a more specific claim.'),
    confidence: 0.82
  },
  {
    signal: 'stock_phrase',
    pattern: /\b(?:marks?|represents?) a pivotal moment in (?:the )?(?:evolving )?(?:landscape|history|journey) of\b/giu,
    comment: namedComment('Historic inflation', 'The construction declares importance before supplying evidence that this is genuinely a turning point.'),
    confidence: 0.92
  },
  {
    signal: 'stock_phrase',
    pattern: /\b(?:a (?:rich )?tapestry(?: of)?|in the realm of|the intricate interplay(?: between| of)?)\b/giu,
    comment: namedComment('Decorative abstraction', 'Ornament is standing in for the particular elements and relationship that matter.'),
    confidence: 0.92
  },
  {
    signal: 'stock_phrase',
    pattern: /\bserve(?:s|d)? as (?:a )?testament to\b/giu,
    comment: namedComment('Ceremonial claim', 'This formula announces significance instead of demonstrating it through evidence or consequence.'),
    confidence: 0.95
  },
  {
    signal: 'stock_phrase',
    pattern: /\b(?:may potentially|might potentially|could possibly|may possibly)\b/giu,
    comment: namedComment('Double hedge', 'Two uncertainty markers do the work of one. Choose the degree of uncertainty you actually mean.'),
    confidence: 0.93
  },
  {
    signal: 'rhetorical_formula',
    pattern: /\bnot (?:just|merely|simply)\b[^.!?\n]{3,100}?(?:,?\s+but\b|\s*[;—-]\s*(?:it|this|they|he|she)\s+(?:is|are|was|were)\b)/giu,
    comment: namedComment('Forced contrast', 'The second clause receives automatic drama. Check whether the evidence earns the contrast or whether one direct claim is stronger.'),
    confidence: 0.86
  },
  {
    signal: 'rhetorical_formula',
    pattern: /\bnot only\b[^.!?\n]{3,100}?\bbut (?:it |they |we |he |she )?also\b/giu,
    comment: namedComment('Double promise', 'The balanced halves often repeat one benefit in two forms. Check whether each clause adds distinct information.'),
    confidence: 0.88
  },
  {
    signal: 'rhetorical_formula',
    pattern: /\b(?:I(?:'m| am)) not (?:saying|asking|suggesting)\b[^.!?\n]{3,120}?[.!?]\s*(?:I(?:'m| am)) (?:saying|asking|suggesting)\b[^.!?\n]*[.!?]?/giu,
    comment: namedComment('Balanced correction', 'This polished dialogue formula can make different speakers sound written by the same rhetorician.'),
    confidence: 0.9
  },
  {
    signal: 'rhetorical_formula',
    pattern: /\b(?:there(?:'s| is) a (?:difference|distinction)|those are (?:different|not the same) things)\b[.!?]?/giu,
    comment: namedComment('Formula capper', 'This sentence often explains a contrast the preceding exchange has already made clear.'),
    confidence: 0.86
  },
  {
    signal: 'rhetorical_formula',
    pattern: /\b(?:which|that) means either\b[^.!?\n]{3,100}?\bor\b/giu,
    comment: namedComment('Binary packaging', 'The formula may force a cleaner either/or choice than the subject supports.'),
    confidence: 0.75
  },
  {
    signal: 'rhetorical_formula',
    pattern: /\bwhile\b[^.!?\n]{3,100}?\b(?:offers?|provides?|brings?|has)\b[^.!?\n]{1,100}?,\s*(?:it|this|they) also\b[^.!?\n]*/giu,
    comment: namedComment('Synthetic balance', 'The sentence supplies a generic benefit/challenge balance. Ask whether either side makes a concrete, necessary claim.'),
    confidence: 0.79
  },
  {
    signal: 'stock_phrase',
    pattern: /\bdespite (?:these|the) challenges,? (?:the )?future remains (?:bright|promising|hopeful)\b/giu,
    comment: namedComment('Sunny fog', 'The optimism has no condition, forecast, or accountable prediction attached to it.'),
    confidence: 0.94
  },
  {
    signal: 'stock_phrase',
    pattern: /\b(?:serves? as (?:a|the) (?:hub|platform|solution)|boasts? (?:a|an|the) )\b/giu,
    comment: namedComment('Inflated verb', 'The sentence may be clearer with “is” or “has”, followed by the concrete capability.'),
    confidence: 0.82
  },
  {
    signal: 'dangling_significance',
    pattern: /,\s+(?:underscoring|highlighting|showcasing|demonstrating|emphasizing|reflecting|reinforcing)\b[^.!?\n]*/giu,
    comment: namedComment('Dangling interpretation', 'The trailing participial phrase adds declared importance without necessarily adding evidence.'),
    confidence: 0.84
  },
  {
    signal: 'unnamed_authority',
    pattern: /\b(?:experts? (?:believe|say|argue|warn|suggest)|critics? (?:argue|say|claim)|studies (?:show|suggest|indicate|reveal)|research (?:shows|suggests|indicates)|it is widely (?:believed|accepted|recognized))\b/giu,
    comment: namedComment('Unnamed authority', 'Name the expert, critic, study, or evidence—or state clearly that the attribution is unavailable.'),
    confidence: 0.9
  },
  {
    signal: 'stock_phrase',
    pattern: /\b(?:great question|that(?:'s| is) an excellent (?:point|question)|absolutely[!.]? let me|you raise an important (?:point|consideration))\b/giu,
    comment: namedComment('Sycophantic opening', 'Praise and restatement delay the useful response. Begin with the answer unless the social acknowledgement matters.'),
    confidence: 0.91
  },
  {
    signal: 'fiction_cliche',
    pattern: /\bcouldn(?:'t|’t| not) help but feel\b/giu,
    comment: namedComment('Involuntary-emotion cliché', 'Render the particular thought, sensation, or action instead of reporting an unavoidable feeling.'),
    confidence: 0.92
  },
  {
    signal: 'fiction_cliche',
    pattern: /\b(?:the air was thick with|the silence (?:was|hung|stretched|grew) (?:heavy|thick|oppressive|deafening))\b/giu,
    comment: namedComment('Atmospheric cliché', 'Replace the abstract atmosphere with a concrete sensory pressure or consequential silence.'),
    confidence: 0.9
  },
  {
    signal: 'fiction_cliche',
    pattern: /\b(?:a (?:wave|pang|surge|rush|flicker) of [\p{L}'’-]+ (?:washed over|ran through|passed through) (?:him|her|them|me)|(?:he|she|they) felt a (?:surge|rush|wave|pang|flicker) of [\p{L}'’-]+)\b/giu,
    comment: namedComment('Packaged emotion', 'The stock physical wave substitutes for a character-specific bodily response, thought, or choice.'),
    confidence: 0.9
  },
  {
    signal: 'fiction_cliche',
    pattern: /\blet out a breath (?:he|she|they) didn(?:'t|’t| not) (?:know|realize) (?:he|she|they) (?:was|were|had been) holding\b/giu,
    comment: namedComment('Held-breath cliché', 'This beat is extremely familiar. Keep the release only if the surrounding action makes it character-specific.'),
    confidence: 0.96
  },
  {
    signal: 'fiction_cliche',
    pattern: /\b(?:eyes widened|(?:his|her|their) heart pounded in (?:his|her|their) chest|a knowing (?:smile|grin|look|glance)|something (?:dark|ancient|primal|unnamed) stirred)\b/giu,
    comment: namedComment('Stock fiction beat', 'This reaction or portent is heavily conventional. Look for the response only this character or scene would produce.'),
    confidence: 0.84
  },
  {
    signal: 'fiction_cliche',
    pattern: /\b(?:raven|dark|golden|silver) (?:hair|tresses) (?:spilled|cascaded|tumbled|fell)\b|\bpiercing (?:blue|green|gray|grey|dark) eyes\b/giu,
    comment: namedComment('Catalogue-description cliché', 'The phrase uses inherited genre shorthand instead of selecting a revealing, particular detail.'),
    confidence: 0.88
  },
  {
    signal: 'rhetorical_formula',
    pattern: /\bnot (?:from|by|because of)\b[^.!?\n]{3,100}?,?\s*but (?:from|by|because(?: of)?)\b/giu,
    comment: namedComment('Balanced causal contrast', 'The mirrored construction can make narration sound pre-packaged. Check whether the distinction needs this symmetry or can be stated directly.'),
    confidence: 0.78
  }
];

const tierTwoVocabulary = /\b(?:robust|comprehensive|seamless(?:ly)?|transformative|cutting-edge|innovative|streamlin(?:e|es|ed|ing)|empower(?:s|ed|ing)?|foster(?:s|ed|ing)?|enhanc(?:e|es|ed|ing)|elevat(?:e|es|ed|ing)|optimiz(?:e|es|ed|ing)|scalable|pivotal|intricate|profound|resonat(?:e|es|ed|ing)|underscor(?:e|es|ed|ing)|harness(?:es|ed|ing)?|navigat(?:e|es|ed|ing)|cultivat(?:e|es|ed|ing)|bolster(?:s|ed|ing)?|galvaniz(?:e|es|ed|ing)|cornerstone|game-changer)\b/giu;
// Modal verbs and perception verbs are deliberately excluded here: “could hear”,
// “might reach” and “appeared open” need semantic context before they can be called
// hedges. The mechanical cluster rule only counts unequivocal uncertainty markers.
const hedgePattern = /\b(?:possibly|potentially|perhaps|arguably|apparently|presumably|conceivably|ostensibly|it is possible that)\b/giu;

function wordCount(text: string): number {
  return text.trim() ? text.trim().split(/\s+/u).length : 0;
}

function sentenceSpans(text: string): Array<{ from: number; to: number; text: string }> {
  const spans: Array<{ from: number; to: number; text: string }> = [];
  const pattern = /[^.!?\n]+(?:[.!?]+|$)/gu;
  for (const match of text.matchAll(pattern)) {
    const raw = match[0];
    const leading = raw.search(/\S/u);
    if (leading < 0) continue;
    const trimmed = raw.trimEnd();
    const from = (match.index ?? 0) + leading;
    spans.push({ from, to: (match.index ?? 0) + trimmed.length, text: text.slice(from, (match.index ?? 0) + trimmed.length) });
  }
  return spans;
}

function paragraphSpans(text: string): Array<{ from: number; to: number; text: string }> {
  const spans: Array<{ from: number; to: number; text: string }> = [];
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

function clusteredSentenceSignal(
  sentences: Array<{ from: number; to: number; text: string }>,
  pattern: RegExp,
  minimum: number,
  maximumSpan: number,
  signal: AITellSignal,
  comment: (count: number) => string,
  confidence: number
): AITellFinding[] {
  const matching = sentences.filter((sentence) => pattern.test(sentence.text));
  pattern.lastIndex = 0;
  const findings: AITellFinding[] = [];
  for (let index = 0; index <= matching.length - minimum;) {
    let end = index + minimum;
    if (matching[end - 1].to - matching[index].from > maximumSpan) {
      index += 1;
      continue;
    }
    while (end < matching.length && matching[end].to - matching[index].from <= maximumSpan) end += 1;
    const cluster = matching.slice(index, end);
    const primary = cluster[minimum - 1];
    findings.push({
      ...primary,
      anchors: cluster.map(({ from, to }) => ({ from, to })),
      signal,
      comment: comment(cluster.length),
      confidence
    });
    index = end;
  }
  return findings;
}

function paragraphClusterFindings(text: string): AITellFinding[] {
  const findings: AITellFinding[] = [];
  for (const paragraph of paragraphSpans(text)) {
    const suspicious = [...paragraph.text.matchAll(tierTwoVocabulary)];
    if (suspicious.length >= 3) {
      const anchors = suspicious.map((match) => ({
        from: paragraph.from + (match.index ?? 0),
        to: paragraph.from + (match.index ?? 0) + match[0].length
      }));
      findings.push({
        ...anchors[2],
        anchors,
        signal: 'suspicious_vocabulary_cluster',
        comment: namedComment('Buzzword bundle', `This is the third of ${anchors.length} flattering or abstract stock terms clustered here. Replace approval-language with measurable qualities or concrete effects.`),
        confidence: 0.84
      });
    }
    const hedges = [...paragraph.text.matchAll(hedgePattern)];
    if (hedges.length >= 3) {
      const anchors = hedges.map((match) => ({
        from: paragraph.from + (match.index ?? 0),
        to: paragraph.from + (match.index ?? 0) + match[0].length
      }));
      const primary = anchors[2];
      findings.push({
        ...primary,
        anchors,
        signal: 'hedge_cluster',
        comment: namedComment('Hedge parade', `${anchors.length} explicit uncertainty markers accumulate in one paragraph. State what is known, and identify the specific uncertainty that remains.`),
        confidence: 0.8
      });
    }
  }
  return findings;
}

function statisticalFindings(text: string): AITellFinding[] {
  if (wordCount(text) < 50) return [];
  const findings: AITellFinding[] = [...paragraphClusterFindings(text)];
  const sentences = sentenceSpans(text);
  const paragraphs = paragraphSpans(text);

  const transitionParagraphs = paragraphs.filter((paragraph) => /^(?:however|furthermore|additionally|moreover|nevertheless|consequently|nonetheless|similarly|ultimately)\b/iu.test(paragraph.text));
  if (transitionParagraphs.length >= 3) {
    const anchors = transitionParagraphs.map((paragraph) => {
      const opener = /^(?:however|furthermore|additionally|moreover|nevertheless|consequently|nonetheless|similarly|ultimately)\b/iu.exec(paragraph.text)!;
      return { from: paragraph.from, to: paragraph.from + opener[0].length };
    });
    findings.push({
      ...anchors[2], anchors,
      signal: 'repeated_transition',
      comment: namedComment('Transition parade', `${anchors.length} paragraphs use formal transition openers. The scaffolding is becoming more visible than the logic or scene movement.`),
      confidence: 0.84
    });
  }

  findings.push(...clusteredSentenceSignal(
    sentences,
    /^(?:[“"']?)(?:I|we|he|she|they|[A-Z][\p{L}'’-]+)\s+(?:did|does|do|was|were|is|are|could|would|will)\s+not\b/iu,
    3,
    1600,
    'repeated_negative_assertion',
    (count) => namedComment('Negative-assertion repetition', `This is the third of ${count} nearby sentences using the same negative structure. The cluster may make absence feel mechanically enumerated.`),
    0.86
  ));

  findings.push(...clusteredSentenceSignal(
    sentences,
    /\b(?:thought|think|thinks|thinking) about\b/iu,
    3,
    1600,
    'catalogued_thought',
    (count) => namedComment('Cataloguing by thinking', `This is the third of ${count} nearby “thought about” sentences. The repetition turns interiority into a topic list; render one thought directly or let the scene interrupt it.`),
    0.84
  ));

  const sectionBreaks = [...text.matchAll(/(?:^|\n)\s*(---+)\s*(?=\n|$)/gu)];
  const sectionBreakAnchors = sectionBreaks.map((match) => {
    const relative = match[0].indexOf(match[1]);
    return { from: (match.index ?? 0) + relative, to: (match.index ?? 0) + relative + match[1].length };
  });
  if (sectionBreakAnchors.length >= 3) findings.push({
    ...sectionBreakAnchors[2], anchors: sectionBreakAnchors,
    signal: 'section_break_crutch',
    comment: namedComment('Section-break crutch', `This is the third of ${sectionBreakAnchors.length} section breaks. Check that each marks a genuine time, place, or viewpoint change.`),
    confidence: 0.78
  });

  for (let index = 3; index < sentences.length; index += 1) {
    const window = sentences.slice(index - 3, index + 1);
    const starters = window.map((sentence) => /^[“"'‘’(\[]*([\p{L}'’-]+)/u.exec(sentence.text)?.[1]?.toLowerCase());
    if (!starters[0] || !starters.every((starter) => starter === starters[0])) continue;
    const starter = /^[“"'‘’(\[]*([\p{L}'’-]+)/u.exec(sentences[index].text)![1];
    findings.push({
      from: sentences[index].from,
      to: sentences[index].from + starter.length,
      anchors: window.map((sentence) => {
        const value = /^[“"'‘’(\[]*([\p{L}'’-]+)/u.exec(sentence.text)![1];
        return { from: sentence.from, to: sentence.from + value.length };
      }),
      signal: 'repeated_sentence_opening',
      comment: namedComment('Repeated sentence opening', `Four consecutive sentences begin with “${starter}”. Check whether the repeated launch is deliberate or a default rhythm.`),
      confidence: 0.75
    });
    index += 3;
  }

  const dashes = [...text.matchAll(/—|--/gu)].map((match) => ({
    from: match.index ?? 0,
    to: (match.index ?? 0) + match[0].length
  }));
  const dashCount = dashes.length;
  if (dashCount >= 4 && dashCount / wordCount(text) * 1000 >= 12) {
    findings.push({
      ...dashes[3], anchors: dashes,
      signal: 'dash_density',
      comment: namedComment('Em-dash overload', `This is the fourth of ${dashCount} dashes in a dense run. Check whether they are doing distinct work or have become the default sentence joint.`),
      confidence: 0.76
    });
  }
  return findings;
}

export function detectAITells(text: string, limit = 20): AITellFinding[] {
  const findings: AITellFinding[] = [];
  for (const rule of patternRules) {
    for (const match of text.matchAll(rule.pattern)) {
      const from = match.index ?? 0;
      findings.push({
        from,
        to: from + match[0].length,
        signal: rule.signal,
        comment: rule.comment,
        confidence: rule.confidence
      });
    }
  }
  findings.push(...statisticalFindings(text));
  return findings
    .filter((finding) => Number.isInteger(finding.from) && Number.isInteger(finding.to)
      && finding.from >= 0 && finding.to > finding.from && finding.to <= text.length
      && Boolean(text.slice(finding.from, finding.to).trim()))
    .map((finding) => {
      const anchors = (finding.anchors ?? [{ from: finding.from, to: finding.to }])
        .filter((anchor) => Number.isInteger(anchor.from) && Number.isInteger(anchor.to)
          && anchor.from >= 0 && anchor.to > anchor.from && anchor.to <= text.length
          && Boolean(text.slice(anchor.from, anchor.to).trim()))
        .filter((anchor, index, all) => all.findIndex((candidate) => candidate.from === anchor.from && candidate.to === anchor.to) === index);
      return { ...finding, anchors };
    })
    .sort((left, right) => left.from - right.from || right.confidence - left.confidence)
    .filter((finding, index, all) => !all.some((other, otherIndex) => otherIndex !== index
      && other.from <= finding.from
      && other.to >= finding.to
      && (other.from < finding.from || other.to > finding.to || otherIndex < index)
      && other.confidence >= finding.confidence))
    .slice(0, Math.max(0, limit));
}
