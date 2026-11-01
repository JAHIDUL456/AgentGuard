import * as vscode from 'vscode';
import { ILogger } from '../../core/logger';
import { ConfidenceLevel, Finding, FindingCategory, FindingSeverity } from '../../core/types';
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
            category: 'analysis-incomplete',
            severity: 'info',
            confidence: 'low',
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

    // Map confirmed new diagnostics to findings
    for (const newDiag of delta.newDiagnostics) {
      findings.push(this._createFindingFromDiagnostic(newDiag));
    }

    // Map uncertain diagnostics if baseline was unavailable
    for (const uncDiag of delta.uncertainDiagnostics) {
      findings.push({
        id: `diag-uncertain-${uncDiag.id}`,
        category: 'analysis-incomplete',
        severity: 'info',
        confidence: 'low',
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

  private _createFindingFromDiagnostic(diag: DiagnosticFingerprint): Finding {
    const severity: FindingSeverity =
      diag.severity === vscode.DiagnosticSeverity.Error
        ? 'error'
        : diag.severity === vscode.DiagnosticSeverity.Warning
        ? 'warning'
        : 'info';

    // High confidence if backed by standard language server source or compiler code
    const confidence: ConfidenceLevel =
      diag.source !== 'compiler' || Boolean(diag.code) ? 'high' : 'medium';

    const codeSnippet = diag.code ? `[${diag.code}] ` : '';
    const titleSnippet = this._truncate(diag.normalizedMessage, 60);

    return {
      id: `diag-new-${diag.primaryKey}-${diag.line}:${diag.character}`,
      category: 'confirmed-new-diagnostic',
      severity,
      confidence,
      title: `Confirmed New ${severity.toUpperCase()}: ${codeSnippet}${titleSnippet}`,
      message: diag.message,
      evidence: `Source: ${diag.source || 'compiler'}, Code: ${diag.code || 'N/A'}, Range: L${diag.line + 1}:C${diag.character + 1} to L${diag.range.end.line + 1}:C${diag.range.end.character + 1}`,
      explanation:
        'Newly introduced compiler or type diagnostic detected after code modification. This error did not exist in the clean baseline snapshot.',
      location: {
        filePath: diag.relativeFilePath,
        uri: diag.fileUri,
        range: diag.range,
      },
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

