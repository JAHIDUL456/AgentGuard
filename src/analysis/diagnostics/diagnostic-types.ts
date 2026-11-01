import * as vscode from 'vscode';

export type DiagnosticClassification =
  | 'confirmed-new-diagnostic'
  | 'existing'
  | 'resolved'
  | 'changed'
  | 'uncertain';

export interface DiagnosticFingerprint {
  readonly id: string;
  readonly primaryKey: string;
  readonly fileUri: vscode.Uri;
  readonly relativeFilePath: string;
  readonly source: string;
  readonly code: string;
  readonly severity: vscode.DiagnosticSeverity;
  readonly message: string;
  readonly normalizedMessage: string;
  readonly range: vscode.Range;
  readonly line: number;
  readonly character: number;
  readonly relatedInformation?: readonly {
    readonly message: string;
    readonly uri: vscode.Uri;
    readonly range: vscode.Range;
  }[];
}

export interface DiagnosticSnapshot {
  readonly capturedAt: number;
  readonly isBaseline: boolean;
  readonly fingerprintsByFile: ReadonlyMap<string, readonly DiagnosticFingerprint[]>;
  readonly allFingerprints: readonly DiagnosticFingerprint[];
}

export interface DiagnosticDeltaResult {
  readonly newDiagnostics: readonly DiagnosticFingerprint[];
  readonly existingDiagnostics: readonly DiagnosticFingerprint[];
  readonly resolvedDiagnostics: readonly DiagnosticFingerprint[];
  readonly changedDiagnostics: readonly DiagnosticFingerprint[];
  readonly uncertainDiagnostics: readonly DiagnosticFingerprint[];
  readonly isBaselineReady: boolean;
}
