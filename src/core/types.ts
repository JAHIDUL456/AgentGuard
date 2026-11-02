import * as vscode from 'vscode';

export type FindingSeverity = 'error' | 'warning' | 'info';

export type ConfidenceLevel = 'high' | 'medium' | 'low';

/**
 * Authoritative evidence classifications for codebase safety regressions.
 * Guesses must never be represented as confirmed errors.
 */
export type EvidenceClassification =
  | 'confirmed-regression'
  | 'structural-regression'
  | 'needs-review';

/**
 * Current operational status of a finding.
 */
export type FindingStatus = 'open' | 'resolved' | 'suppressed' | 'verified';

/**
 * Formal verification state of the finding against codebase baseline.
 */
export type VerificationState =
  | 'unverified'
  | 'verified-clean'
  | 'verified-breaking';

export type FindingCategory =
  | 'untouched-file'
  | 'diagnostic-regression'
  | 'logic-risk'
  | 'broken-dependency'
  | 'confirmed-new-diagnostic'
  | 'potentially-affected-dependency'
  | 'potentially-broken-contract'
  | 'unresolved-reference'
  | 'analysis-incomplete'
  | 'unused-code'
  | 'type-safety';

export interface FindingLocation {
  readonly filePath: string;
  readonly uri: vscode.Uri;
  readonly range?: vscode.Range;
  readonly workspaceRootUri?: vscode.Uri;
  readonly workspaceRootPath?: string;
}

export interface RelatedDiagnosticDetail {
  readonly code?: string;
  readonly message: string;
  readonly source?: string;
  readonly range?: vscode.Range;
}

/**
 * Single authoritative diagnostic contract shared across all AgentGuard components.
 */
export interface Finding {
  /** Stable unique identifier for deduplication and persistence */
  readonly id: string;
  /** Stable rule or analyzer ID */
  readonly ruleId?: string;
  /** Functional category */
  readonly category: FindingCategory;
  /** UI presentation severity: error (critical), warning, info */
  readonly severity: FindingSeverity;
  /** Analysis confidence level */
  readonly confidence: ConfidenceLevel;
  /** Rigorous evidence classification: Confirmed Regression, Structural Regression, Needs Review */
  readonly evidenceClassification?: EvidenceClassification;
  /** Current lifecycle status */
  readonly status?: FindingStatus;
  /** Human-readable short title */
  readonly title: string;
  /** Detailed error message */
  readonly message: string;
  /** Concise developer-facing explanation */
  readonly explanation: string;
  /** Concrete textual change evidence */
  readonly evidence: string;
  /** Optional change diff or structural delta evidence */
  readonly changeEvidence?: string;
  /** Primary file and range location */
  readonly location: FindingLocation;
  /** Secondary or downstream impact locations */
  readonly relatedLocations?: readonly FindingLocation[];
  /** Related compiler, linter, or language server diagnostics */
  readonly relatedDiagnostics?: readonly RelatedDiagnosticDetail[];
  /** Actionable developer remediation suggestion */
  readonly suggestedRemediation?: string;
  /** Git commit SHA or file content hash */
  readonly sourceVersion?: string;
  /** Analysis generation cycle index */
  readonly analysisGeneration?: number;
  /** Verification state against baseline */
  readonly verificationState?: VerificationState;
  /** Engine ID that produced this finding */
  readonly sourceEngine: string;
  /** Epoch millisecond timestamp */
  readonly timestamp: number;
  /** Custom extensible metadata */
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
