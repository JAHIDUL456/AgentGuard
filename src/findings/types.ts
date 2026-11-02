import * as vscode from 'vscode';
import { Finding, FindingCategory, FindingSeverity } from '../core/types';

export interface FindingFilter {
  readonly categories?: readonly FindingCategory[];
  readonly severities?: readonly FindingSeverity[];
  readonly filePath?: string;
  readonly workspaceRootUri?: vscode.Uri;
}

export interface FindingStats {
  readonly total: number;
  readonly errors: number;
  readonly warnings: number;
  readonly infos: number;
  readonly byCategory: Readonly<Record<FindingCategory, number>>;
}

export interface IFindingManager {
  readonly onDidChangeFindings: (listener: (findings: readonly Finding[]) => unknown) => unknown;
  setFindings(sourceEngine: string, findings: readonly Finding[]): void;
  reconcileScope(
    sourceEngine: string,
    targetUris: readonly vscode.Uri[] | undefined,
    findings: readonly Finding[],
    generation?: number
  ): void;
  addFinding(finding: Finding): void;
  updateFinding(finding: Finding): void;
  removeFinding(id: string): void;
  removeFindingsForUri(uri: vscode.Uri): void;
  migrateUri(oldUri: vscode.Uri, newUri: vscode.Uri): void;
  clear(): void;
  clearByEngine(engineId: string): void;
  clearByWorkspace(rootUri: vscode.Uri): void;
  getAll(): readonly Finding[];
  getFindingsForUri(uri: vscode.Uri): readonly Finding[];
  filter(filter: FindingFilter): readonly Finding[];
  getStats(): FindingStats;
  getResolvedHistory(): readonly Finding[];
  clearResolvedHistory(): void;
}

