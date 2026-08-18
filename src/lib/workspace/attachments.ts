export type NodeId = string;

export interface TextTarget {
  type: 'text';
  nodeId: NodeId;
  start: number;
  end: number;
}

export interface NodeTarget {
  type: 'node';
  nodeId: NodeId;
  includeDescendants: boolean;
}

export interface NodeRangeTarget {
  type: 'nodeRange';
  fromNodeId: NodeId;
  toNodeId: NodeId;
}

export type ContentTarget = TextTarget | NodeTarget | NodeRangeTarget;

export interface TargetSet {
  mode: 'snapshot' | 'live';
  targets: ContentTarget[];
  originalText?: string;
  sourceRevision?: number;
}

export interface AttachmentBehaviour {
  id: string;
  insertionAtStart: 'include' | 'exclude';
  insertionAtEnd: 'include' | 'exclude';
  insertionInside: 'include' | 'exclude';
  partialDeletion: 'shrink' | 'split' | 'detach';
  completeDeletion: 'remove' | 'detach' | 'change_state';
  changedState?: string;
  deletedState?: string;
  replacementText: 'include' | 'exclude';
  copy: 'copy' | 'reference' | 'omit';
  move: 'follow';
}

export interface FormatProperties {
  strikethrough?: boolean;
  bold?: boolean;
  italic?: boolean;
  style?: string;
}

export interface FormatAttachment {
  id: string;
  target: TargetSet;
  properties: FormatProperties;
  behaviourId: string;
  priority: number;
  createdAtRevision: number;
}

export interface TextChange {
  nodeId: NodeId;
  from: number;
  to: number;
  insertedLength: number;
  deletedText?: string;
  insertedText?: string;
}

export type TargetChange = 'unchanged' | 'moved' | 'changed' | 'removed' | 'detached';

export interface TargetTransform {
  target: TargetSet;
  change: TargetChange;
}

export const defaultAttachmentBehaviours: Record<string, AttachmentBehaviour> = {
  'format-default': {
    id: 'format-default',
    insertionAtStart: 'include',
    insertionAtEnd: 'include',
    insertionInside: 'include',
    partialDeletion: 'shrink',
    completeDeletion: 'remove',
    replacementText: 'include',
    copy: 'copy',
    move: 'follow'
  },
  'craft-input': {
    id: 'craft-input',
    insertionAtStart: 'exclude',
    insertionAtEnd: 'exclude',
    insertionInside: 'include',
    partialDeletion: 'shrink',
    completeDeletion: 'change_state',
    changedState: 'target_changed',
    deletedState: 'target_removed',
    replacementText: 'include',
    copy: 'omit',
    move: 'follow'
  },
  'persistent-input': {
    id: 'persistent-input',
    insertionAtStart: 'exclude',
    insertionAtEnd: 'exclude',
    insertionInside: 'include',
    partialDeletion: 'shrink',
    completeDeletion: 'detach',
    changedState: 'target_changed',
    deletedState: 'target_removed',
    replacementText: 'include',
    copy: 'reference',
    move: 'follow'
  }
};

export function textTarget(nodeId: NodeId, start: number, end: number, originalText?: string): TargetSet {
  return {
    mode: 'snapshot',
    targets: [{ type: 'text', nodeId, start, end }],
    originalText
  };
}

function maxChange(left: TargetChange, right: TargetChange): TargetChange {
  const order: TargetChange[] = ['unchanged', 'moved', 'changed', 'detached', 'removed'];
  return order.indexOf(right) > order.indexOf(left) ? right : left;
}

function transformInsertion(target: TextTarget, change: TextChange, behaviour: AttachmentBehaviour): { targets: TextTarget[]; change: TargetChange } {
  const amount = change.insertedLength;
  const position = change.from;
  if (!amount) return { targets: [target], change: 'unchanged' };
  if (position < target.start) {
    return { targets: [{ ...target, start: target.start + amount, end: target.end + amount }], change: 'moved' };
  }
  if (position > target.end) return { targets: [target], change: 'unchanged' };
  if (position === target.start) {
    return behaviour.insertionAtStart === 'include'
      ? { targets: [{ ...target, end: target.end + amount }], change: 'changed' }
      : { targets: [{ ...target, start: target.start + amount, end: target.end + amount }], change: 'moved' };
  }
  if (position === target.end) {
    return behaviour.insertionAtEnd === 'include'
      ? { targets: [{ ...target, end: target.end + amount }], change: 'changed' }
      : { targets: [target], change: 'unchanged' };
  }
  if (behaviour.insertionInside === 'include') {
    return { targets: [{ ...target, end: target.end + amount }], change: 'changed' };
  }
  return {
    targets: [
      { ...target, end: position },
      { ...target, start: position + amount, end: target.end + amount }
    ].filter((item) => item.start < item.end),
    change: 'changed'
  };
}

function transformReplacement(target: TextTarget, change: TextChange, behaviour: AttachmentBehaviour): { targets: TextTarget[]; change: TargetChange } {
  const removedLength = change.to - change.from;
  const delta = change.insertedLength - removedLength;

  if (change.to <= target.start) {
    return { targets: [{ ...target, start: target.start + delta, end: target.end + delta }], change: delta ? 'moved' : 'unchanged' };
  }
  if (change.from >= target.end) return { targets: [target], change: 'unchanged' };

  const fullyCovered = change.from <= target.start && change.to >= target.end;
  if (fullyCovered && change.insertedLength === 0) {
    if (behaviour.completeDeletion === 'detach') return { targets: [], change: 'detached' };
    return { targets: [], change: 'removed' };
  }

  if (fullyCovered && behaviour.replacementText === 'exclude') {
    return { targets: [], change: behaviour.completeDeletion === 'detach' ? 'detached' : 'removed' };
  }

  const mappedStart = target.start < change.from
    ? target.start
    : target.start >= change.to
      ? target.start + delta
      : change.from;
  const mappedEnd = target.end > change.to
    ? target.end + delta
    : target.end <= change.from
      ? target.end
      : change.from + change.insertedLength;

  if (behaviour.replacementText === 'exclude' && change.insertedLength > 0) {
    const pieces: TextTarget[] = [];
    if (target.start < change.from) pieces.push({ ...target, end: change.from });
    if (target.end > change.to) {
      pieces.push({ ...target, start: change.from + change.insertedLength, end: target.end + delta });
    }
    if (!pieces.length) return { targets: [], change: 'removed' };
    return { targets: pieces, change: 'changed' };
  }

  if (mappedStart >= mappedEnd) {
    if (behaviour.partialDeletion === 'detach' || behaviour.completeDeletion === 'detach') return { targets: [], change: 'detached' };
    return { targets: [], change: 'removed' };
  }
  return { targets: [{ ...target, start: mappedStart, end: mappedEnd }], change: 'changed' };
}

function transformTextTarget(target: TextTarget, change: TextChange, behaviour: AttachmentBehaviour): { targets: TextTarget[]; change: TargetChange } {
  if (target.nodeId !== change.nodeId) return { targets: [target], change: 'unchanged' };
  return change.from === change.to
    ? transformInsertion(target, change, behaviour)
    : transformReplacement(target, change, behaviour);
}

/** Transform an attachment target through an ordered sequence of editor changes. */
export function transformTargetSet(targetSet: TargetSet, changes: TextChange[], behaviour: AttachmentBehaviour): TargetTransform {
  let targets = targetSet.targets;
  let overall: TargetChange = 'unchanged';

  for (const editorChange of changes) {
    const next: ContentTarget[] = [];
    for (const target of targets) {
      if (target.type === 'text') {
        const transformed = transformTextTarget(target, editorChange, behaviour);
        next.push(...transformed.targets);
        overall = maxChange(overall, transformed.change);
      } else {
        next.push(target);
        if (target.type === 'node' && target.nodeId === editorChange.nodeId) overall = maxChange(overall, 'changed');
      }
    }
    targets = next;
  }

  return { target: { ...targetSet, targets }, change: overall };
}

export function firstTextTarget(targetSet: TargetSet): TextTarget | null {
  return targetSet.targets.find((target): target is TextTarget => target.type === 'text') ?? null;
}

export function targetLabel(targetSet: TargetSet): string {
  if (!targetSet.targets.length) return 'Detached target';
  return targetSet.targets.map((target) => {
    if (target.type === 'text') return `${target.nodeId} · ${target.start}–${target.end}`;
    if (target.type === 'node') return target.includeDescendants ? `${target.nodeId} and descendants` : target.nodeId;
    return `${target.fromNodeId}–${target.toNodeId}`;
  }).join(', ');
}

export function sameTarget(left: TargetSet, right: TargetSet): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

/** Effective value for a selection fully covered by applicable format attachments. */
export function selectionHasStrikethrough(formats: FormatAttachment[], nodeId: NodeId, from: number, to: number): boolean {
  const applicable = formats
    .map((format, index) => ({ format, index }))
    .filter(({ format }) => format.properties.strikethrough !== undefined)
    .filter(({ format }) => format.target.targets.some((target) => {
      if (target.type === 'node') return target.nodeId === nodeId && target.includeDescendants;
      if (target.type === 'text') return target.nodeId === nodeId && target.start <= from && target.end >= to;
      return false;
    }))
    .sort((left, right) => left.format.priority - right.format.priority
      || left.format.createdAtRevision - right.format.createdAtRevision
      || left.index - right.index);
  return applicable.at(-1)?.format.properties.strikethrough === true;
}
