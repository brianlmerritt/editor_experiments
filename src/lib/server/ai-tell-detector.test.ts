import { describe, expect, it } from 'vitest';
import { detectAITells } from './ai-tell-detector';

describe('AI tell editorial detector', () => {
  it('returns exact, bounded evidence for high-signal formulas', () => {
    const text = 'It is worth noting that the scheme serves as a testament to their resolve. It was not just difficult, but impossible.';
    const findings = detectAITells(text);

    expect(findings.map((finding) => text.slice(finding.from, finding.to))).toEqual([
      'It is worth noting that',
      'serves as a testament to',
      'not just difficult, but'
    ]);
    expect(findings.every((finding) => finding.confidence >= 0 && finding.confidence <= 1)).toBe(true);
  });

  it('does not claim ordinary short prose is machine-written', () => {
    expect(detectAITells('Mara folded the letter and put it beneath the chipped blue cup.')).toEqual([]);
  });

  it('only raises document-level repetition after enough evidence exists', () => {
    const text = [
      'He did not answer. The clock carried on. Nothing else moved.',
      'She did not turn. Rain ran down the glass. The room cooled.',
      'They did not speak. The nurse closed the door. Footsteps receded.',
      'Mara did not follow. The lift doors closed. A telephone rang somewhere.',
      'He thought about home. The radiator clicked. Mara watched him.',
      'She thought about Peter. A trolley passed. The light changed.',
      'They thought about tomorrow. Nobody named it. The clock carried on.'
    ].join('\n\n');
    const findings = detectAITells(text);

    expect(findings.some((finding) => finding.signal === 'repeated_negative_assertion')).toBe(true);
    expect(findings.filter((finding) => finding.signal === 'repeated_negative_assertion')).toHaveLength(1);
    expect(findings.find((finding) => finding.signal === 'repeated_negative_assertion')?.anchors).toHaveLength(4);
    expect(findings.some((finding) => finding.signal === 'catalogued_thought')).toBe(true);
    expect(findings.every((finding) => text.slice(finding.from, finding.to).length > 0)).toBe(true);
  });

  it('does not apply statistical heuristics to a short selection', () => {
    expect(detectAITells('He did not answer. She did not turn. They did not speak.')).toEqual([]);
  });

  it('does not equate three similarly sized paragraphs with an actionable tell', () => {
    const text = [
      'Mara opened the door. Rain crossed the tiles. The porter watched her. Nobody spoke.',
      'She set down her case. The clock lost another minute. A train passed. Nobody moved.',
      'Peter folded the paper. Mara read the heading. The porter turned away. The rain continued.'
    ].join('\n\n');

    expect(detectAITells(text)).toEqual([]);
  });

  it('anchors the named language and rhetoric patterns from the editorial catalogue', () => {
    const text = [
      'In today\'s fast-paced digital landscape, nobody waits.',
      'Let\'s delve into the fascinating world of clocks.',
      'It is important to note that the platform is late.',
      'At its core, the scheme is simple.',
      'The result serves as a testament to their resolve.',
      'This marks a pivotal moment in the evolving landscape of rail travel.',
      'It reveals a rich tapestry of choices.',
      'It is not just a tool; it is a game-changer.',
      'Not only does it save time, but it also reduces delay.',
      'The train arrived, underscoring its enduring relevance.',
      'Experts believe the change will help.',
      'While the technology offers benefits, it also presents challenges.',
      'Despite these challenges, the future remains promising.',
      'The platform serves as a hub that boasts a comprehensive timetable.',
      'In conclusion, the platform matters.'
    ].join('\n');

    const names = detectAITells(text, 100).map((finding) => finding.comment.split(' — ')[0]);
    expect(names).toEqual(expect.arrayContaining([
      'Stock opener',
      'Fake invitation',
      'Importance warning',
      'Hollow centre',
      'Ceremonial claim',
      'Historic inflation',
      'Decorative abstraction',
      'Forced contrast',
      'Double promise',
      'Dangling interpretation',
      'Unnamed authority',
      'Synthetic balance',
      'Sunny fog',
      'Inflated verb',
      'Conclusion announcement'
    ]));
  });

  it('flags suspicious vocabulary and hedging only when they form a cluster', () => {
    const text = [
      'The robust, seamless, transformative solution perhaps, possibly, arguably helps the station.',
      'Its timetable lists every arrival and departure, but the committee has not measured whether passengers actually reach their trains sooner.',
      'Mara folded the printed proposal and asked for the missing figures before anyone approved it.',
      'Outside, rain crossed the road and gathered beneath the cracked stone steps while commuters waited for the evening bus.'
    ].join(' ');

    const findings = detectAITells(text, 100);
    const buzzwords = findings.find((finding) => finding.comment.startsWith('Buzzword bundle —'));
    const hedges = findings.find((finding) => finding.comment.startsWith('Hedge parade —'));

    expect(buzzwords?.anchors).toHaveLength(3);
    expect(hedges?.anchors).toHaveLength(3);
  });

  it('does not mistake ability, opportunity, perception, or impossibility for a hedge parade', () => {
    const text = `I put that where I could find it later. Then the long pause. Three counts, timed in the preparation house in front of a cracked mirror and in front of rows of examiners since. This room was bigger than any of those rooms and the quiet went further out into it. I gave it a fourth count and went on. I talked about annihilation. I talked about the self as obstruction, and about the Beloved, who is real, who is not a person, who can be approached and never held. The words were the words. My throat has carried them for eight years and it carried them again without catching once. I was inside the delivery and I was up above it at the same time, counting. The room came down to the pen and my own voice. The tea went out of my attention. So did the rain on the window and the grey light coming through it onto the boards. I was still counting. Her bursts against my clauses, four between, and underneath both of those the tally of how many sentences I had left. Nasima's eyes went to Suraiya and came back before I could read what was in them. I could not tell whether she was checking the transcription or the transcriber. I did not slow down. I finished. The last sentence is the one I wrote on smuggled paper at nineteen and have never revised, because it came out right the first time and I knew it while the ink was drying. I put it into the grey light and let the room have it. I was good at this. I had known it since I was fourteen, standing in front of the first examiner, watching his pen go while he wrote down what I had done to him. Nasima took up her pen. She wrote four lines and set it down across the paper. The crease at her eyes had not moved. "And afterwards," she said. The voice had not changed at all. "When it let you go. What was the first thing you noticed?" Eight years of examiners had stopped at the arrival. Every one of them asked me to describe getting there, and every one of them wrote down what I gave them and sent me to the next room. Not one had asked what came after. I looked down at my hands. The fingers had curled in and the knuckles had gone white where I was holding them shut. I answered before I had decided to. "The floor was cold," I said. "I noticed my hands were open." Nasima took up the pen. She wrote past four lines. She wrote past eight. She went down the length of the page, turned it over, and wrote on the next one. At the side table Suraiya's pen started, and the two of them ran together, hers coming along behind Nasima's. I waited to be corrected. There is no after. It is the first thing they teach in the preparation house and I have said it to examiners in those words, and I had just sat in the Custodian's room and described a floor. I sat in the hard chair with the hair going cold on my shoulder and waited for her to put the pen down and tell me that nothing is released, that there is no floor to be cold, that what I had described was not union and could not be.`;
    const findings = detectAITells(text, 100);

    expect(findings.filter((finding) => finding.signal === 'hedge_cluster')).toEqual([]);
  });

  it('covers the exact fiction clichés retained from autonovel', () => {
    const text = [
      'Mara couldn\'t help but feel a sense of dread.',
      'The weight of expectation settled over her.',
      'The silence grew heavy.',
      'Her eyes widened.',
      'She let out a breath she didn\'t know she was holding.'
    ].join(' ');

    const names = detectAITells(text, 100).map((finding) => finding.comment.split(' — ')[0]);
    expect(names).toEqual(expect.arrayContaining([
      'Involuntary-emotion cliché',
      'Atmospheric cliché',
      'Stock fiction beat',
      'Held-breath cliché'
    ]));
  });

  it('detects recurrent structural crutches without treating one occurrence as a pattern', () => {
    const text = [
      'He remembered the way rain struck the roof. The station stayed open while the last passengers crossed beneath its lights.',
      '---',
      'She watched the way Peter folded the map. A porter moved the abandoned cases away from the platform edge.',
      '---',
      'They spoke about the way Mara had left. Nobody answered when the final announcement echoed through the empty hall.',
      '---',
      'Mara waited by the clock. Mara counted seven minutes. Mara checked the platform. Mara closed her eyes.'
    ].join('\n');

    const findings = detectAITells(text, 100);
    expect(findings.some((finding) => finding.signal === 'section_break_crutch')).toBe(true);
    expect(findings.some((finding) => finding.signal === 'repeated_sentence_opening')).toBe(true);
  });

  it('does not turn ordinary emotion labels, literal weight, or way idioms into AI patterns', () => {
    const text = [
      'He was scared, but he stayed beside her and listened.',
      'She focused on the weight of the mattress beneath her.',
      'He moved out of the way and walked the rest of the way home.',
      'The following morning they crossed the station and waited beside the porter while rain moved over the glass.'
    ].join(' ');

    expect(detectAITells(text, 100)).toEqual([]);
  });

  it('reports a parade of formal paragraph transitions rather than each isolated transition', () => {
    const text = [
      'However, Mara kept the station open while the storm moved across the fields and the last passengers waited beneath the awning.',
      'Furthermore, Peter checked every platform before locking the doors and carrying the abandoned cases into the office.',
      'Additionally, the porter wrote down each delay because the morning inspector would ask for a complete account.',
      'Moreover, nobody had explained why the platform clock remained exactly seven minutes slow after every repair.'
    ].join('\n');

    const findings = detectAITells(text, 100).filter((finding) => finding.signal === 'repeated_transition');
    expect(findings).toHaveLength(1);
    expect(findings[0].anchors).toHaveLength(4);
    expect(findings.every((finding) => finding.comment.startsWith('Transition parade —'))).toBe(true);
  });

  it('groups a dense em-dash pattern under one finding with every dash as evidence', () => {
    const text = 'Mara waited—Peter counted—the porter watched—and the clock continued—while rain crossed the empty platform. '.repeat(6);
    const findings = detectAITells(text, 100).filter((finding) => finding.signal === 'dash_density');

    expect(findings).toHaveLength(1);
    expect(findings[0].anchors).toHaveLength(24);
    expect(findings[0].comment).toContain('fourth of 24 dashes');
  });
});
