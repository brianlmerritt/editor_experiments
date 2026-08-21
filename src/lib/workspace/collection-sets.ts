import type { CollectionDefinition } from './navigator';

export interface CollectionSetItem {
  id: string;
  name: string;
  singularName: string;
  icon: CollectionDefinition['icon'];
  numbering: CollectionDefinition['numbering'];
}

export interface CollectionSetDefinition {
  id: string;
  name: string;
  description: string;
  items: CollectionSetItem[];
}

export interface CollectionSetDraft extends CollectionSetItem {
  selected: boolean;
}

export const collectionSets: CollectionSetDefinition[] = [
  {
    id: 'core-story',
    name: 'Core story',
    description: 'The broad containers used to organise a manuscript.',
    items: [
      { id: 'chapters', name: 'Chapters', singularName: 'Chapter', icon: 'folder', numbering: { enabled: true, start: 1 } },
      { id: 'scenes', name: 'Scenes', singularName: 'Scene', icon: 'file', numbering: { enabled: true, start: 1 } }
    ]
  },
  {
    id: 'story-planning',
    name: 'Story planning',
    description: 'Optional planning material that can sit around the manuscript.',
    items: [
      { id: 'scene-beats', name: 'Scene Beats', singularName: 'Scene Beat', icon: 'file', numbering: { enabled: true, start: 1 } },
      { id: 'plot-threads', name: 'Plot Threads', singularName: 'Plot Thread', icon: 'link', numbering: { enabled: false, start: 1 } },
      { id: 'themes', name: 'Themes', singularName: 'Theme', icon: 'file', numbering: { enabled: false, start: 1 } },
      { id: 'foreshadowing', name: 'Foreshadowing', singularName: 'Foreshadowing Note', icon: 'file', numbering: { enabled: false, start: 1 } }
    ]
  },
  {
    id: 'story-world',
    name: 'Story world',
    description: 'People, places and other durable parts of the fictional world.',
    items: [
      { id: 'characters', name: 'Characters', singularName: 'Character', icon: 'file', numbering: { enabled: false, start: 1 } },
      { id: 'locations', name: 'Locations', singularName: 'Location', icon: 'file', numbering: { enabled: false, start: 1 } },
      { id: 'organisations', name: 'Organisations', singularName: 'Organisation', icon: 'file', numbering: { enabled: false, start: 1 } },
      { id: 'objects', name: 'Objects', singularName: 'Object', icon: 'file', numbering: { enabled: false, start: 1 } }
    ]
  },
  {
    id: 'research',
    name: 'Research',
    description: 'Source material and working notes for fiction or non-fiction.',
    items: [
      { id: 'sources', name: 'Sources', singularName: 'Source', icon: 'link', numbering: { enabled: false, start: 1 } },
      { id: 'notes', name: 'Notes', singularName: 'Note', icon: 'file', numbering: { enabled: false, start: 1 } },
      { id: 'references', name: 'References', singularName: 'Reference', icon: 'link', numbering: { enabled: false, start: 1 } }
    ]
  }
];

export function collectionSetDrafts(): Record<string, CollectionSetDraft> {
  return Object.fromEntries(collectionSets.flatMap((set) => set.items.map((item) => [
    item.id,
    { ...item, numbering: { ...item.numbering }, selected: false }
  ])));
}

export function sameCollectionName(left: string, right: string): boolean {
  return left.trim().toLocaleLowerCase() === right.trim().toLocaleLowerCase();
}
