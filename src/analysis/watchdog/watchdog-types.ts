import * as vscode from 'vscode';
import { ConfidenceLevel } from '../../core/types';

export type WatchdogCategory =
  | 'authentication'
  | 'authorization'
  | 'validation'
  | 'error-handling'
  | 'security'
  | 'type-safety';

export type WatchdogRuleSeverity =
  | 'critical'
  | 'warning'
  | 'review'
  | 'informational';

export interface CodeLine {
  readonly line: number;
  readonly text: string;
  readonly trimmed: string;
}

export interface CodeChangeContext {
  readonly uri: vscode.Uri;
  readonly relativeFilePath: string;
  readonly isTestFile: boolean;
  readonly oldContent: string;
  readonly newContent: string;
  readonly removedLines: readonly CodeLine[];
  readonly addedLines: readonly CodeLine[];
  readonly languageId: string;
}

export interface WatchdogFindingCandidate {
  readonly ruleId: string;
  readonly category: WatchdogCategory;
  readonly severity: WatchdogRuleSeverity;
  readonly confidence: ConfidenceLevel;
  readonly title: string;
  readonly message: string;
  readonly evidence: string;
  readonly explanation: string;
  readonly line: number;
  readonly endLine?: number;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface IWatchdogRule {
  readonly id: string;
  readonly name: string;
  readonly category: WatchdogCategory;
  readonly supportedLanguages: readonly string[];
  inspect(context: CodeChangeContext): Promise<readonly WatchdogFindingCandidate[]>;
}
