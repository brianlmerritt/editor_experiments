import type { Node as ProseMirrorNode } from 'prosemirror-model';

export interface DeletionBoundaryPlan {
  removeBefore: number;
  removeAfter: number;
  insert: string;
  capitalized: boolean;
}

export interface DocumentDeletionPlan {
  from: number;
  to: number;
  insert: string;
  capitalized: boolean;
}

const wrapperPairs: Record<string, string> = {
  '(': ')',
  '[': ']',
  '{': '}',
  '“': '”',
  '‘': '’'
};

function beginsSentence(before: string): boolean {
  const trimmed = before.trimEnd();
  if (/^[“"'‘([{]*$/u.test(trimmed)) return true;
  return /[.!?](?:[”"'’“‘)\]}([{]*)$/u.test(trimmed);
}

function needsBoundarySpace(left: string, right: string): boolean {
  if (!left || !right) return false;
  if (/[\s([{“‘—–]$/u.test(left)) return false;
  if (/^[\s,.;:!?)}\]”’—–]/u.test(right)) return false;
  return true;
}

/**
 * Plans a word/phrase deletion without touching the document. Separator punctuation
 * directly attached to the deleted phrase is removed, whitespace is repaired, and a
 * newly exposed sentence-initial word is capitalized.
 */
export function planDeletionBoundaries(before: string, after: string): DeletionBoundaryPlan {
  const atSentenceStart = beginsSentence(before);
  let removeBefore = 0;
  let removeAfter = 0;

  const openingWrapper = before.match(/[ \t]*([([{“‘])[ \t]*$/u);
  const closingWrapper = after.match(/^[ \t]*([)\]}”’])[ \t]*/u);
  if (openingWrapper && closingWrapper && wrapperPairs[openingWrapper[1]] === closingWrapper[1]) {
    removeBefore += openingWrapper[0].length;
    removeAfter += closingWrapper[0].length;
  }

  let remainingBefore = before.slice(0, before.length - removeBefore);
  let remainingAfter = after.slice(removeAfter);

  const precedingSeparator = remainingBefore.match(/[ \t]*[,;:—–]+[ \t]*$/u);
  if (precedingSeparator) {
    removeBefore += precedingSeparator[0].length;
    remainingBefore = before.slice(0, before.length - removeBefore);
  }

  const followingSeparator = atSentenceStart
    ? remainingAfter.match(/^[ \t]*[,;:—–.!?]+[ \t]*/u)
    : remainingAfter.match(/^[ \t]*[,;:—–]+[ \t]*/u);
  if (followingSeparator) {
    removeAfter += followingSeparator[0].length;
    remainingAfter = after.slice(removeAfter);
  }

  const trailingWhitespace = remainingBefore.match(/[ \t]+$/u)?.[0] ?? '';
  removeBefore += trailingWhitespace.length;
  remainingBefore = before.slice(0, before.length - removeBefore);

  const leadingWhitespace = remainingAfter.match(/^[ \t]+/u)?.[0] ?? '';
  removeAfter += leadingWhitespace.length;
  remainingAfter = after.slice(removeAfter);

  let capitalized = false;
  let replacementPrefix = '';
  let boundaryRight = remainingAfter;
  if (atSentenceStart) {
    const initial = remainingAfter.match(/^([“"'‘([{]*[ \t]*)(\p{Ll})/u);
    if (initial) {
      const consumed = initial[1].length + initial[2].length;
      removeAfter += consumed;
      replacementPrefix = `${initial[1]}${initial[2].toLocaleUpperCase()}`;
      boundaryRight = `${replacementPrefix}${remainingAfter.slice(consumed)}`;
      capitalized = true;
    }
  }

  const insert = `${needsBoundarySpace(remainingBefore, boundaryRight) ? ' ' : ''}${replacementPrefix}`;
  return { removeBefore, removeAfter, insert, capitalized };
}

/** Resolve boundary cleanup within a single ProseMirror text block. */
export function planDocumentDeletion(doc: ProseMirrorNode, from: number, to: number): DocumentDeletionPlan {
  if (from >= to) return { from, to, insert: '', capitalized: false };
  const $from = doc.resolve(from);
  const $to = doc.resolve(to);
  if ($from.parent !== $to.parent || !$from.parent.isTextblock) return { from, to, insert: '', capitalized: false };

  const before = $from.parent.textBetween(0, $from.parentOffset, '');
  const after = $to.parent.textBetween($to.parentOffset, $to.parent.content.size, '');
  const boundary = planDeletionBoundaries(before, after);
  return {
    from: from - boundary.removeBefore,
    to: to + boundary.removeAfter,
    insert: boundary.insert,
    capitalized: boundary.capitalized
  };
}
