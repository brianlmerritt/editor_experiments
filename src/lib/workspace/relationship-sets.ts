import type { RelationshipDefinition } from './navigator';

export interface RelationshipSetItem {
  id: string;
  forwardLabel: string;
  inverseLabel: string;
  description: string;
  symmetric?: boolean;
}

export interface RelationshipSetDefinition {
  id: string;
  name: string;
  description: string;
  items: RelationshipSetItem[];
}

export interface RelationshipSetDraft extends RelationshipSetItem {
  selected: boolean;
}

export const relationshipSets: RelationshipSetDefinition[] = [
  {
    id: 'narrative-essentials',
    name: 'Narrative essentials',
    description: 'Participation, viewpoint, causality, revelation, setup, and payoff.',
    items: [
      { id: 'features', forwardLabel: 'features', inverseLabel: 'appears in', description: 'Connect a passage or scene with something that participates in it.' },
      { id: 'viewpoint', forwardLabel: 'uses viewpoint of', inverseLabel: 'is viewpoint character in', description: 'Record whose perception governs a narrative unit.' },
      { id: 'setting', forwardLabel: 'is set in', inverseLabel: 'is setting for', description: 'Connect a narrative unit with its setting.' },
      { id: 'establishes', forwardLabel: 'establishes', inverseLabel: 'is established by', description: 'Introduce a fact, condition, character quality, or expectation.' },
      { id: 'reveals', forwardLabel: 'reveals', inverseLabel: 'is revealed in', description: 'Expose knowledge or information in a particular unit.' },
      { id: 'conceals', forwardLabel: 'conceals', inverseLabel: 'is concealed in', description: 'Record deliberate withheld knowledge or information.' },
      { id: 'causes', forwardLabel: 'causes', inverseLabel: 'is caused by', description: 'Record story causality rather than simple sequence.' },
      { id: 'motivates', forwardLabel: 'motivates', inverseLabel: 'is motivated by', description: 'Connect an action, choice, or event with its motivation.' },
      { id: 'foreshadows', forwardLabel: 'foreshadows', inverseLabel: 'is foreshadowed by', description: 'Connect an earlier signal with later material.' },
      { id: 'pays-off', forwardLabel: 'pays off', inverseLabel: 'is set up by', description: 'Connect a payoff with the material that prepared it.' }
    ]
  },
  {
    id: 'character-change',
    name: 'Character knowledge and change',
    description: 'Knowledge, belief, desire, emotional state, and development over a scoped part of the work.',
    items: [
      { id: 'knows', forwardLabel: 'knows', inverseLabel: 'is known by', description: 'Record knowledge held by a character or participant.' },
      { id: 'believes', forwardLabel: 'believes', inverseLabel: 'is believed by', description: 'Record a belief that may differ from objective truth.' },
      { id: 'suspects', forwardLabel: 'suspects', inverseLabel: 'is suspected by', description: 'Record uncertain or emerging knowledge.' },
      { id: 'wants', forwardLabel: 'wants', inverseLabel: 'is wanted by', description: 'Connect a character with a goal, outcome, or object of desire.' },
      { id: 'fears', forwardLabel: 'fears', inverseLabel: 'is feared by', description: 'Connect a character with a feared person, event, or outcome.' },
      { id: 'has-state', forwardLabel: 'has state', inverseLabel: 'is state of', description: 'Attach a scoped state or condition to a character or entity.' },
      { id: 'becomes', forwardLabel: 'becomes', inverseLabel: 'develops from', description: 'Connect one durable state or identity with its successor.' },
      { id: 'remembers', forwardLabel: 'remembers', inverseLabel: 'is remembered by', description: 'Record remembered people, events, facts, or places.' }
    ]
  },
  {
    id: 'story-world',
    name: 'Story world',
    description: 'People, organisations, places, objects, ownership, and allegiance.',
    items: [
      { id: 'owns', forwardLabel: 'owns', inverseLabel: 'is owned by', description: 'Record ownership or possession.' },
      { id: 'belongs-to', forwardLabel: 'belongs to', inverseLabel: 'includes', description: 'Connect an entity with the group or whole it belongs to.' },
      { id: 'member-of', forwardLabel: 'is member of', inverseLabel: 'has member', description: 'Record organisational or group membership.' },
      { id: 'located-in', forwardLabel: 'is located in', inverseLabel: 'contains', description: 'Record world location without changing Navigator containment.' },
      { id: 'uses', forwardLabel: 'uses', inverseLabel: 'is used by', description: 'Connect a person, group, or place with an object or resource.' },
      { id: 'opposes', forwardLabel: 'opposes', inverseLabel: 'is opposed by', description: 'Record active opposition between world entities.' },
      { id: 'allied-with', forwardLabel: 'is allied with', inverseLabel: 'is allied with', description: 'Record a mutual alliance.', symmetric: true },
      { id: 'family-of', forwardLabel: 'is family of', inverseLabel: 'is family of', description: 'Record a family connection clarified by the relationship note.', symmetric: true }
    ]
  },
  {
    id: 'argument-evidence',
    name: 'Argument and evidence',
    description: 'Claims, evidence, examples, counterarguments, and qualifications.',
    items: [
      { id: 'makes-claim', forwardLabel: 'makes claim', inverseLabel: 'is claimed in', description: 'Connect a section or author with a claim.' },
      { id: 'supports', forwardLabel: 'supports', inverseLabel: 'is supported by', description: 'Connect evidence or reasoning with the claim it supports.' },
      { id: 'challenges', forwardLabel: 'challenges', inverseLabel: 'is challenged by', description: 'Record counterevidence or a counterargument.' },
      { id: 'refutes', forwardLabel: 'refutes', inverseLabel: 'is refuted by', description: 'Record a stronger rejection than qualification or challenge.' },
      { id: 'qualifies', forwardLabel: 'qualifies', inverseLabel: 'is qualified by', description: 'Limit or refine the scope of a claim.' },
      { id: 'exemplifies', forwardLabel: 'exemplifies', inverseLabel: 'is exemplified by', description: 'Connect an example or case with the idea it demonstrates.' },
      { id: 'defines', forwardLabel: 'defines', inverseLabel: 'is defined by', description: 'Connect a term or concept with its definition.' },
      { id: 'depends-on', forwardLabel: 'depends on', inverseLabel: 'is required by', description: 'Record a logical or explanatory dependency.' }
    ]
  },
  {
    id: 'research',
    name: 'Research',
    description: 'Sources, quotations, provenance, verification, and conflicting findings.',
    items: [
      { id: 'cites', forwardLabel: 'cites', inverseLabel: 'is cited by', description: 'Connect writing or research notes with a source.' },
      { id: 'quotes', forwardLabel: 'quotes', inverseLabel: 'is quoted by', description: 'Connect an exact quotation with its use.' },
      { id: 'derived-from', forwardLabel: 'is derived from', inverseLabel: 'is source for', description: 'Record provenance for data, conclusions, or transformed material.' },
      { id: 'corroborates', forwardLabel: 'corroborates', inverseLabel: 'is corroborated by', description: 'Record independent supporting research.' },
      { id: 'disputes', forwardLabel: 'disputes', inverseLabel: 'is disputed by', description: 'Record conflicting research or testimony.' },
      { id: 'verifies', forwardLabel: 'verifies', inverseLabel: 'is verified by', description: 'Record completed verification of a fact or source.' },
      { id: 'investigates', forwardLabel: 'investigates', inverseLabel: 'is investigated by', description: 'Connect a research task or source with its subject.' },
      { id: 'synthesises', forwardLabel: 'synthesises', inverseLabel: 'is synthesised in', description: 'Connect several research materials with a synthesis.' }
    ]
  },
  {
    id: 'non-fiction',
    name: 'Non-fiction',
    description: 'Explanation, comparison, context, case studies, and section-level development.',
    items: [
      { id: 'introduces', forwardLabel: 'introduces', inverseLabel: 'is introduced by', description: 'Connect an opening section with the subject it introduces.' },
      { id: 'explains', forwardLabel: 'explains', inverseLabel: 'is explained by', description: 'Connect explanatory material with its subject.' },
      { id: 'contextualises', forwardLabel: 'contextualises', inverseLabel: 'is contextualised by', description: 'Supply historical, social, technical, or biographical context.' },
      { id: 'compares-with', forwardLabel: 'compares with', inverseLabel: 'is compared with', description: 'Record an intentional comparison between subjects.' },
      { id: 'contrasts-with', forwardLabel: 'contrasts with', inverseLabel: 'is contrasted with', description: 'Record an intentional contrast between subjects.' },
      { id: 'case-study-of', forwardLabel: 'is case study of', inverseLabel: 'has case study', description: 'Connect a detailed case with the broader subject it illuminates.' },
      { id: 'summarises', forwardLabel: 'summarises', inverseLabel: 'is summarised by', description: 'Connect a summary with its source material or argument.' },
      { id: 'develops', forwardLabel: 'develops', inverseLabel: 'is developed by', description: 'Record where a subject, explanation, or argument is developed.' }
    ]
  }
];

export function relationshipSetDrafts(): Record<string, RelationshipSetDraft> {
  return Object.fromEntries(relationshipSets.flatMap((set) => set.items.map((item) => [
    `${set.id}:${item.id}`,
    { ...item, id: `${set.id}:${item.id}`, selected: false }
  ])));
}

function normalise(value: string): string {
  return value.trim().toLocaleLowerCase().replace(/\s+/g, ' ');
}

export function sameRelationshipDefinition(
  definition: Pick<RelationshipDefinition, 'forwardLabel' | 'inverseLabel'>,
  candidate: Pick<RelationshipDefinition, 'forwardLabel' | 'inverseLabel'>
): boolean {
  const forward = normalise(definition.forwardLabel);
  const inverse = normalise(definition.inverseLabel);
  const candidateForward = normalise(candidate.forwardLabel);
  const candidateInverse = normalise(candidate.inverseLabel);
  return (forward === candidateForward && inverse === candidateInverse)
    || (forward === candidateInverse && inverse === candidateForward);
}
