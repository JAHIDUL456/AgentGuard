import * as vscode from 'vscode';

export type ChangeKind = 'created' | 'modified' | 'deleted';

export interface FileChangeEvent {
  readonly uri: vscode.Uri;
  readonly kind: ChangeKind;
  readonly timestamp: number;
}

export interface IChangeMonitor {
  readonly onDidChangeFiles: vscode.Event<readonly FileChangeEvent[]>;
  setEnabled(enabled: boolean): void;
  isEnabled(): boolean;
}

