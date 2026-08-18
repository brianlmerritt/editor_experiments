import type { Suggestion } from '$lib/domain';
import type { FormatAttachment, TextChange } from './attachments';

export interface EditorSelection {
  from: number;
  to: number;
}

export interface EditorDocumentSnapshot {
  doc: Record<string, unknown>;
  text: string;
  selection: EditorSelection;
}

export interface EditorTransactionOrigin {
  kind: 'human' | 'input_acceptance' | 'workspace_history' | 'system';
  inputId?: string;
  source?: string;
}

export interface EditorTransactionDetail {
  before: EditorDocumentSnapshot;
  after: EditorDocumentSnapshot;
  changes: TextChange[];
  origin: EditorTransactionOrigin;
}

export interface WorkspaceHistorySnapshot {
  document: EditorDocumentSnapshot;
  inputs: Suggestion[];
  formats: FormatAttachment[];
  revision: number;
}

export interface WorkspaceHistoryEntry {
  id: string;
  source: 'human' | 'ai' | 'format' | 'input' | 'system';
  label: string;
  before: WorkspaceHistorySnapshot;
  after: WorkspaceHistorySnapshot;
  createdAt: number;
  group?: string;
}

export function cloneHistorySnapshot(snapshot: WorkspaceHistorySnapshot): WorkspaceHistorySnapshot {
  return JSON.parse(JSON.stringify(snapshot)) as WorkspaceHistorySnapshot;
}
