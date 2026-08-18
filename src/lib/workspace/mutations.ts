import type { Suggestion } from '$lib/domain';
import {
  defaultAttachmentBehaviours,
  firstTextTarget,
  transformTargetSet,
  type AttachmentBehaviour,
  type FormatAttachment,
  type TextChange
} from './attachments';

export interface AttachmentMutationInput {
  inputs: Suggestion[];
  formats: FormatAttachment[];
  behaviours?: Record<string, AttachmentBehaviour>;
  changes: TextChange[];
  revision: number;
  transactionId: string;
  acceptedInputId?: string;
}

export interface AttachmentMutationResult {
  inputs: Suggestion[];
  formats: FormatAttachment[];
}

function copyTarget<T>(target: T): T {
  // Svelte state is proxied and cannot be passed to structuredClone in the browser.
  // Attachment targets are deliberately JSON data, so serialize at this boundary.
  return JSON.parse(JSON.stringify(target)) as T;
}

function behaviourFor(id: string, behaviours: Record<string, AttachmentBehaviour>, fallback: string): AttachmentBehaviour {
  return behaviours[id] ?? defaultAttachmentBehaviours[id] ?? defaultAttachmentBehaviours[fallback];
}

/** Apply editor changes to every format and input through the shared target transformer. */
export function applyAttachmentChanges(input: AttachmentMutationInput): AttachmentMutationResult {
  const behaviours = { ...defaultAttachmentBehaviours, ...(input.behaviours ?? {}) };
  const inputs = input.inputs.map((record) => {
    const previousTarget = copyTarget(record.target);
    const transformed = transformTargetSet(record.target, input.changes, behaviourFor(record.behaviourId, behaviours, 'craft-input'));
    const first = firstTextTarget(transformed.target);
    const anchor = first ? { ...record.anchor, from: first.start, to: first.end } : record.anchor;

    if (record.id === input.acceptedInputId) {
      return { ...record, target: transformed.target, anchor, state: 'accepted' as const };
    }

    const live = record.state === 'pending' || record.state === 'hidden';
    if (!live || transformed.change === 'unchanged' || transformed.change === 'moved') {
      return { ...record, target: transformed.target, anchor };
    }

    const behaviour = behaviourFor(record.behaviourId, behaviours, 'craft-input');
    const targetRemoved = transformed.change === 'removed' || transformed.change === 'detached';
    const state = targetRemoved
      ? behaviour.deletedState ?? 'target_removed'
      : behaviour.changedState ?? 'target_changed';
    const eventType = targetRemoved ? 'target_removed' as const : 'target_changed' as const;
    return {
      ...record,
      target: transformed.target,
      anchor,
      state: state as Suggestion['state'],
      events: [
        ...record.events,
        {
          type: eventType,
          revision: input.revision + 1,
          transactionId: input.transactionId,
          previousTarget,
          previousExcerpt: record.anchor.text
        }
      ]
    };
  });

  const formats = input.formats.flatMap((format) => {
    const transformed = transformTargetSet(format.target, input.changes, behaviourFor(format.behaviourId, behaviours, 'format-default'));
    if (transformed.change === 'removed' || transformed.change === 'detached' || !transformed.target.targets.length) return [];
    return [{ ...format, target: transformed.target }];
  });

  return { inputs, formats };
}
