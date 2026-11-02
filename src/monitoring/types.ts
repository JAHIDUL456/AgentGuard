import * as vscode from 'vscode';

export type ChangeKind = 'created' | 'modified' | 'deleted' | 'renamed';

export type EventSource =
  | 'document'
  | 'save'
  | 'watcher'
  | 'rename'
  | 'workspace'
  | 'diagnostics';

export interface FileChangeEvent {
  readonly uri: vscode.Uri;
  readonly kind: ChangeKind;
  readonly timestamp: number;
  readonly oldUri?: vscode.Uri;
  readonly source: EventSource;
}

export interface ChangeBatch {
  readonly id: string;
  readonly events: readonly FileChangeEvent[];
  readonly affectedUris: readonly vscode.Uri[];
  readonly timestamp: number;
}

export interface IChangeMonitor {
  readonly onDidChangeFiles: vscode.Event<readonly FileChangeEvent[]>;
  readonly onDidBatchReady: vscode.Event<ChangeBatch>;
  setEnabled(enabled: boolean): void;
  isEnabled(): boolean;
  clearQueue(): void;
  getPendingCount(): number;
}
