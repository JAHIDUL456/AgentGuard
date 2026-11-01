import * as vscode from 'vscode';

export type FindingSeverity = 'error' | 'warning' | 'info';

export type FindingCategory =
  | 'untouched-file'
  | 'diagnostic-regression'
  | 'logic-risk'
  | 'broken-dependency';

export interface FindingLocation {
  readonly filePath: string;
  readonly uri: vscode.Uri;
  readonly range?: vscode.Range;
}

export interface Finding {
  readonly id: string;
  readonly category: FindingCategory;
  readonly severity: FindingSeverity;
  readonly title: string;
  readonly message: string;
  readonly location: FindingLocation;
  readonly sourceEngine: string;
  readonly timestamp: number;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export type EngineState =
  | 'uninitialized'
  | 'initializing'
  | 'ready'
  | 'analyzing'
  | 'disposed';

export interface EngineStatus {
  readonly state: EngineState;
  readonly activeWorkspaceFolders: number;
  readonly findingCount: number;
  readonly lastScanTimestamp?: number;
}

