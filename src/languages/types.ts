import * as vscode from 'vscode';

export type LanguageCapability =
  | 'diagnostics'
  | 'ast-inspection'
  | 'dependency-graph'
  | 'symbol-resolution';

export interface ILanguageAdapter {
  readonly id: string;
  readonly displayName: string;
  readonly fileExtensions: readonly string[];
  readonly capabilities: readonly LanguageCapability[];
  supports(uri: vscode.Uri): boolean;
}

