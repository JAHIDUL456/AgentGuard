import * as vscode from 'vscode';
import { ILogger } from '../../core/logger';
import {
  ConfidenceLevel,
  EvidenceClassification,
  Finding,
  FindingCategory,
  FindingSeverity,
  RelatedDiagnosticDetail,
} from '../../core/types';
import { AnalysisScope, IAnalysisEngine } from '../types';
import { DiagnosticTracker } from './diagnostic-tracker';
import { DiagnosticFingerprint } from './diagnostic-types';

export class DiagnosticDeltaEngine implements IAnalysisEngine {
  public readonly id = 'agentguard.diagnostic-delta';
  public readonly name = 'Diagnostic Delta Engine';
  public readonly category: FindingCategory = 'confirmed-new-diagnostic';

  constructor(
    private readonly _tracker: DiagnosticTracker,
    private readonly _logger: ILogger
  ) {}

  public async analyze(
    scope: AnalysisScope,
    token?: vscode.CancellationToken
  ): Promise<readonly Finding[]> {
    if (token?.isCancellationRequested) {
      return [];
    }

    if (!this._tracker.isBaselineReady) {
      this._logger.info('Diagnostic baseline not ready yet. Attempting baseline capture...');
      await this._tracker.captureBaseline(token);

      if (token?.isCancellationRequested) {
        return [];
      }

      // If still not ready, emit an informational analysis-incomplete finding
      if (!this._tracker.isBaselineReady) {
        return [
          {
            id: 'diagnostic-baseline-initializing',
            ruleId: 'compiler.baseline-initializing',
            category: 'analysis-incomplete',
            severity: 'info',
            confidence: 'low',
            evidenceClassification: 'needs-review',
            status: 'open',
            title: 'Diagnostic Baseline Initializing',
            message:
              'Language server diagnostics baseline is still settling. Diagnostic regressions will be tracked on next change cycle.',
            evidence: 'Baseline state is unready.',
            explanation:
              'AgentGuard requires a clean settled baseline before flagging newly introduced compiler errors to prevent flagging pre-existing project errors.',
            location: {
              filePath: 'workspace',
              uri: scope.workspaceRoots[0]?.uri ?? vscode.Uri.file('/workspace'),
            },
            sourceEngine: this.id,
            timestamp: Date.now(),
          },
        ];
      }
    }

    const delta = await this._tracker.computeDelta(scope.targetUris, token);
    if (token?.isCancellationRequested) {
      return [];
    }

    const findings: Finding[] = [];

    // Group and deduplicate new diagnostics by file and signature to prevent duplicate findings
    const groupedNew = new Map<string, DiagnosticFingerprint[]>();
    for (const newDiag of delta.newDiagnostics) {
      const groupKey = `${newDiag.fileUri.fsPath}::${newDiag.code || newDiag.source || 'diag'}::${newDiag.normalizedMessage}`;
      const list = groupedNew.get(groupKey) ?? [];
      list.push(newDiag);
      groupedNew.set(groupKey, list);
    }

    for (const group of groupedNew.values()) {
      const primaryDiag = group[0]!;
      const relatedDiags: RelatedDiagnosticDetail[] = group.slice(1).map(d => ({
        code: d.code,
        message: d.message,
        source: d.source,
        range: d.range,
      }));
      findings.push(this._createFindingFromDiagnostic(primaryDiag, relatedDiags));
    }

    // Map uncertain diagnostics if baseline was unavailable
    for (const uncDiag of delta.uncertainDiagnostics) {
      findings.push({
        id: `diag-uncertain-${uncDiag.id}`,
        ruleId: uncDiag.code ? `compiler.uncertain.${uncDiag.code}` : 'compiler.uncertain',
        category: 'analysis-incomplete',
        severity: 'info',
        confidence: 'low',
        evidenceClassification: 'needs-review',
        status: 'open',
        title: `Uncertain Diagnostic Change: ${uncDiag.code ? '[' + uncDiag.code + '] ' : ''}${this._truncate(uncDiag.normalizedMessage, 50)}`,
        message: uncDiag.message,
        evidence: `Source: ${uncDiag.source}, Code: ${uncDiag.code || 'none'}, Line: ${uncDiag.line + 1}`,
        explanation:
          'Diagnostic appeared during unsettled language server state. Confidence is low to prevent false alarm.',
        location: {
          filePath: uncDiag.relativeFilePath,
          uri: uncDiag.fileUri,
          range: uncDiag.range,
        },
        sourceEngine: this.id,
        timestamp: Date.now(),
      });
    }

    this._logger.debug(
      `DiagnosticDeltaEngine produced ${findings.length} finding(s) (${delta.newDiagnostics.length} new, ${delta.existingDiagnostics.length} suppressed existing, ${delta.resolvedDiagnostics.length} resolved).`
    );

    return findings;
  }

  private _createFindingFromDiagnostic(
    diag: DiagnosticFingerprint,
    relatedDiagnostics?: readonly RelatedDiagnosticDetail[]
  ): Finding {
    const msg = diag.message.toLowerCase();
    const code = diag.code.toLowerCase();
    const isExplicitError = diag.severity === vscode.DiagnosticSeverity.Error;

    // 1. Unused-code classification (Never critical)
    const isUnusedCode =
      code === '6133' || // TS6133: is declared but its value is never read
      code === '6196' || // TS6196: is declared but never used
      msg.includes('is declared but its value is never read') ||
      msg.includes('is declared but never used') ||
      msg.includes('unused') ||
      msg.includes('never read');

    let severity: FindingSeverity = 'warning';
    let evidenceClassification: EvidenceClassification = 'structural-regression';
    let category: FindingCategory = 'confirmed-new-diagnostic';
    let remediation: string | undefined;

    if (isUnusedCode) {
      severity = 'info';
      evidenceClassification = 'needs-review';
      category = 'unused-code';
      remediation = 'Remove or use the declared identifier, or prefix with _ to silence.';
    } else if (isExplicitError) {
      // Breaking compiler/syntax errors
      const isBreakingCompilerError =
        code === '2304' || // TS2304: Cannot find name
        code === '2307' || // TS2307: Cannot find module
        code === '2339' || // TS2339: Property does not exist
        code === '2349' || // TS2349: This expression is not callable
        code === '1005' || // TS1005: Syntax error
        msg.includes('cannot find name') ||
        msg.includes('cannot find module') ||
        msg.includes('syntax error') ||
        msg.includes('unexpected token') ||
        msg.includes('is not defined');

      if (isBreakingCompilerError) {
        severity = 'error';
        evidenceClassification = 'confirmed-regression';
        category = 'confirmed-new-diagnostic';
        remediation = 'Verify imports and symbol declarations for missing or mistyped identifier.';
      } else {
        // Normal TypeScript type mismatch or assignability error (Warning, never critical)
        severity = 'warning';
        evidenceClassification = 'structural-regression';
        category = 'type-safety';
        remediation = 'Align variable or parameter types to satisfy the expected interface.';
      }
    } else {
      severity = diag.severity === vscode.DiagnosticSeverity.Warning ? 'warning' : 'info';
      evidenceClassification = 'needs-review';
      category = 'confirmed-new-diagnostic';
      remediation = 'Review the compiler warning.';
    }

    const confidence: ConfidenceLevel =
      diag.source !== 'compiler' || Boolean(diag.code) ? 'high' : 'medium';

    const codeSnippet = diag.code ? `[${diag.code}] ` : '';
    const titleSnippet = this._truncate(diag.normalizedMessage, 60);

    const relatedCountSuffix =
      relatedDiagnostics && relatedDiagnostics.length > 0
        ? ` (+${relatedDiagnostics.length} related)`
        : '';

    return {
      id: `diag-new-${diag.primaryKey}-${diag.line}:${diag.character}`,
      ruleId: diag.code ? `compiler.ts.${diag.code}` : `compiler.${diag.source || 'diag'}`,
      category,
      severity,
      confidence,
      evidenceClassification,
      status: 'open',
      title: `Confirmed New ${severity.toUpperCase()}: ${codeSnippet}${titleSnippet}${relatedCountSuffix}`,
      message: diag.message,
      evidence: `Source: ${diag.source || 'compiler'}, Code: ${diag.code || 'N/A'}, Range: L${diag.line + 1}:C${diag.character + 1} to L${diag.range.end.line + 1}:C${diag.range.end.character + 1}`,
      explanation:
        severity === 'error'
          ? 'Breaking compiler or type diagnostic detected after modification. This did not exist in the clean baseline snapshot.'
          : 'Type-safety or lint diagnostic introduced by recent changes. Review to ensure type soundness.',
      location: {
        filePath: diag.relativeFilePath,
        uri: diag.fileUri,
        range: diag.range,
      },
      relatedDiagnostics: relatedDiagnostics && relatedDiagnostics.length > 0 ? relatedDiagnostics : undefined,
      suggestedRemediation: remediation,
      verificationState: severity === 'error' ? 'verified-breaking' : 'unverified',
      sourceEngine: this.id,
      timestamp: Date.now(),
    };
  }

  private _truncate(str: string, maxLen: number): string {
    if (str.length <= maxLen) {
      return str;
    }
    return str.substring(0, maxLen - 3) + '...';
  }
}

