import * as vscode from 'vscode';

export type FindingSeverity = 'error' | 'warning' | 'info';

export type ConfidenceLevel = 'high' | 'medium' | 'low';

export type FindingCategory =
  | 'untouched-file'
  | 'diagnostic-regression'
  | 'logic-risk'
  | 'broken-dependency'
  | 'confirmed-new-diagnostic'
  | 'potentially-affected-dependency'
  | 'potentially-broken-contract'
  | 'unresolved-reference'
  | 'analysis-incomplete';

export interface FindingLocation {
  readonly filePath: string;
  readonly uri: vscode.Uri;
  readonly range?: vscode.Range;
  readonly workspaceRootUri?: vscode.Uri;
  readonly workspaceRootPath?: string;
}

export interface Finding {
  readonly id: string;
  readonly category: FindingCategory;
  readonly severity: FindingSeverity;
  readonly confidence: ConfidenceLevel;
  readonly title: string;
  readonly message: string;
  readonly evidence: string;
  readonly explanation: string;
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
  readonly gitAvailable: boolean;
  readonly gitRepoCount: number;
}
