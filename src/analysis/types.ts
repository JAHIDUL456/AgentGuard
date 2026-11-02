import * as vscode from 'vscode';
import { Finding, FindingCategory } from '../core/types';
import { WorkspaceRoot } from '../workspace/types';

export type AnalysisLevel = 'fast-local' | 'incremental-dependency' | 'wider';

export interface AnalysisScope {
  readonly workspaceRoots: readonly WorkspaceRoot[];
  readonly targetUris?: readonly vscode.Uri[];
  readonly level?: AnalysisLevel;
}

export interface IAnalysisEngine {
  readonly id: string;
  readonly name: string;
  readonly category: FindingCategory;
  analyze(
    scope: AnalysisScope,
    token?: vscode.CancellationToken
  ): Promise<readonly Finding[]>;
}

