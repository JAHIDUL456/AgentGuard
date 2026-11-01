import * as vscode from 'vscode';

export enum CapabilityLevel {
  Level1_ChangeMonitoring = 1,
  Level2_StructuralAnalysis = 2,
  Level3_DependencyAnalysis = 3,
  Level4_DiagnosticsIntegration = 4,
  Level5_DeepSemanticAnalysis = 5,
}

export type LanguageCapability =
  | 'change-monitoring'
  | 'structural-analysis'
  | 'dependency-graph'
  | 'diagnostics'
  | 'symbol-resolution';

export interface StructuralNode {
  readonly kind:
    | 'function'
    | 'class'
    | 'interface'
    | 'struct'
    | 'enum'
    | 'namespace'
    | 'method'
    | 'trait'
    | 'variable';
  readonly name: string;
  readonly startLine: number;
  readonly endLine: number;
  readonly details?: string;
}

export interface LanguageDiagnostic {
  readonly message: string;
  readonly line: number;
  readonly character: number;
  readonly severity: 'error' | 'warning' | 'info';
  readonly source: string;
}

export interface StructuralAnalysisResult {
  readonly nodes: readonly StructuralNode[];
  readonly imports: readonly string[];
  readonly syntaxErrors: readonly LanguageDiagnostic[];
}

export interface ToolingInfo {
  readonly name: string;
  readonly command?: string;
  isInstalled(): Promise<boolean>;
}

export interface ILanguageAdapter {
  readonly id: string;
  readonly displayName: string;
  readonly fileExtensions: readonly string[];
  readonly languageIds: readonly string[];
  readonly projectManifests: readonly string[];
  readonly capabilityLevel: CapabilityLevel;
  readonly capabilities: readonly LanguageCapability[];
  readonly tooling?: ToolingInfo;
  readonly knownLimitations: readonly string[];

  supports(uri: vscode.Uri): boolean;
  supportsLanguageId(languageId: string): boolean;
  matchesManifest(manifestFileName: string): boolean;

  parseStructure(
    uri: vscode.Uri,
    content: string
  ): Promise<StructuralAnalysisResult>;

  extractDependencies(
    uri: vscode.Uri,
    content: string
  ): Promise<readonly string[]>;

  getDiagnostics(uri: vscode.Uri): Promise<readonly LanguageDiagnostic[]>;
}

export interface DetectedManifest {
  readonly manifestName: string;
  readonly uri: vscode.Uri;
  readonly adapterId: string;
}

export interface WorkspaceLanguageSummary {
  readonly detectedLanguages: readonly ILanguageAdapter[];
  readonly manifests: readonly DetectedManifest[];
  readonly isMultiLanguage: boolean;
  readonly primaryLanguage?: string;
}
