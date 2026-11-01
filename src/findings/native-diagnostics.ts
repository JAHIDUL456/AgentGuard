import * as vscode from 'vscode';
import { Disposable } from '../core/disposable';
import { ILogger } from '../core/logger';
import { Finding } from '../core/types';
import { FindingManager } from './finding-manager';

export class NativeDiagnosticsPublisher extends Disposable {
  private readonly _collection: vscode.DiagnosticCollection;
  private readonly _trackedUris = new Map<string, vscode.Uri>();

  constructor(
    private readonly _findingManager: FindingManager,
    private readonly _logger: ILogger
  ) {
    super();
    this._collection = this._register(
      vscode.languages.createDiagnosticCollection('agentguard')
    );

    this._register(
      this._findingManager.onDidChangeFindings(findings => {
        this.publishFindings(findings);
      })
    );

    // Initial publish
    this.publishFindings(this._findingManager.getAll());
  }

  public get collection(): vscode.DiagnosticCollection {
    return this._collection;
  }

  public publishFindings(findings: readonly Finding[]): void {
    const findingsByUri = new Map<string, { uri: vscode.Uri; findings: Finding[] }>();

    for (const finding of findings) {
      if (finding.location.uri.scheme !== 'file') {
        continue;
      }
      const key = finding.location.uri.toString();
      let entry = findingsByUri.get(key);
      if (!entry) {
        entry = { uri: finding.location.uri, findings: [] };
        findingsByUri.set(key, entry);
      }
      entry.findings.push(finding);
    }

    // Update active URIs
    const newTracked = new Set<string>();

    for (const [key, { uri, findings: fileFindings }] of findingsByUri) {
      newTracked.add(key);
      const diagnostics: vscode.Diagnostic[] = [];
      const seenLineCodes = new Set<string>();

      for (const f of fileFindings) {
        const range =
          f.location.range ?? new vscode.Range(0, 0, 0, 1);

        const dedupeKey = `${range.start.line}:${range.start.character}:${f.category}`;
        if (seenLineCodes.has(dedupeKey)) {
          continue; // Prevent duplicate diagnostics on the same line
        }
        seenLineCodes.add(dedupeKey);

        const severity =
          f.severity === 'error'
            ? vscode.DiagnosticSeverity.Error
            : f.severity === 'warning'
            ? vscode.DiagnosticSeverity.Warning
            : vscode.DiagnosticSeverity.Information;

        const diag = new vscode.Diagnostic(
          range,
          `[${f.confidence.toUpperCase()}] ${f.title}: ${f.message}`,
          severity
        );
        diag.source = 'AgentGuard';
        diag.code = f.category;

        if (f.evidence) {
          diag.relatedInformation = [
            new vscode.DiagnosticRelatedInformation(
              new vscode.Location(f.location.uri, range),
              `Evidence: ${f.evidence}`
            ),
          ];
        }

        diagnostics.push(diag);
      }

      this._collection.set(uri, diagnostics);
    }

    // Clear stale diagnostics for files that no longer have findings
    for (const [prevKey, prevUri] of this._trackedUris) {
      if (!newTracked.has(prevKey)) {
        this._collection.delete(prevUri);
      }
    }

    this._trackedUris.clear();
    for (const [key, { uri }] of findingsByUri) {
      this._trackedUris.set(key, uri);
    }

    this._logger.debug(
      `Published AgentGuard native diagnostics for ${newTracked.size} file(s).`
    );
  }

  public clear(): void {
    this._collection.clear();
    this._trackedUris.clear();
  }

  public override dispose(): void {
    this.clear();
    super.dispose();
  }
}
