import * as vscode from 'vscode';
import { Disposable } from '../../core/disposable';
import { ILogger } from '../../core/logger';
import { GitService } from '../../git/git-service';
import { LanguageAdapterRegistry } from '../../languages/adapter-registry';
import { isIgnoredPath } from '../../utils/path-utils';
import { WorkspaceManager } from '../../workspace/workspace-manager';
import {
  correlateDiagnostics,
  createDiagnosticFingerprint,
} from './diagnostic-fingerprint';
import { DiagnosticSettler } from './diagnostic-settler';
import {
  DiagnosticDeltaResult,
  DiagnosticFingerprint,
} from './diagnostic-types';

export class DiagnosticTracker extends Disposable {
  private readonly _settler: DiagnosticSettler;
  private readonly _baselineFingerprints = new Map<string, DiagnosticFingerprint[]>();
  private _isBaselineReady = false;

  constructor(
    private readonly _workspaceManager: WorkspaceManager,
    private readonly _languageRegistry: LanguageAdapterRegistry,
    private readonly _logger: ILogger,
    settler?: DiagnosticSettler,
    private readonly _gitService?: GitService
  ) {
    super();
    this._settler = settler ?? this._register(new DiagnosticSettler(this._logger));
  }

  public get isBaselineReady(): boolean {
    return this._isBaselineReady;
  }

  public get settler(): DiagnosticSettler {
    return this._settler;
  }

  /**
   * Captures the initial baseline snapshot of existing diagnostics across the workspace.
   */
  public async captureBaseline(
    cancellationToken?: vscode.CancellationToken
  ): Promise<void> {
    this._logger.info('Capturing initial diagnostic baseline...');

    // Allow language servers to settle before taking baseline
    await this._settler.waitForSettling(undefined, cancellationToken);

    if (cancellationToken?.isCancellationRequested) {
      this._logger.info('Baseline capture cancelled.');
      return;
    }

    this._baselineFingerprints.clear();

    const rawDiagnostics = vscode.languages.getDiagnostics();
    let totalCount = 0;

    for (const [uri, diags] of rawDiagnostics) {
      if (uri.scheme !== 'file') {
        continue;
      }
      if (isIgnoredPath(uri.fsPath)) {
        continue;
      }

      const root = this._workspaceManager.getRootForUri(uri);
      if (!root) {
        continue;
      }

      const fps: DiagnosticFingerprint[] = [];
      for (const diag of diags) {
        // Prevent feedback loops: never ingest AgentGuard's own published diagnostics
        if (diag.source && diag.source.toLowerCase() === 'agentguard') {
          continue;
        }
        fps.push(createDiagnosticFingerprint(uri, diag, root.uri));
        totalCount++;
      }

      if (fps.length > 0) {
        this._baselineFingerprints.set(uri.fsPath, fps);
      }
    }

    this._isBaselineReady = true;
    this._logger.info(
      `Baseline captured: ${totalCount} diagnostic(s) across ${this._baselineFingerprints.size} file(s).`
    );
  }

  /**
   * Computes the diagnostic delta between the baseline snapshot and current state.
   */
  public async computeDelta(
    targetUris?: readonly vscode.Uri[],
    cancellationToken?: vscode.CancellationToken
  ): Promise<DiagnosticDeltaResult> {
    if (!this._isBaselineReady) {
      this._logger.warn('Diagnostic delta requested before baseline was established.');
      return {
        newDiagnostics: [],
        existingDiagnostics: [],
        resolvedDiagnostics: [],
        changedDiagnostics: [],
        uncertainDiagnostics: [],
        isBaselineReady: false,
      };
    }

    // Settling check for changed files
    await this._settler.waitForSettling(targetUris, cancellationToken);

    if (cancellationToken?.isCancellationRequested) {
      return {
        newDiagnostics: [],
        existingDiagnostics: [],
        resolvedDiagnostics: [],
        changedDiagnostics: [],
        uncertainDiagnostics: [],
        isBaselineReady: true,
      };
    }

    const currentFingerprints: DiagnosticFingerprint[] = [];
    const baselineFingerprintsToCheck: DiagnosticFingerprint[] = [];

    if (targetUris && targetUris.length > 0) {
      // Delta analysis scoped to target URIs
      for (const uri of targetUris) {
        if (uri.scheme !== 'file' || isIgnoredPath(uri.fsPath)) {
          continue;
        }

        const root = this._workspaceManager.getRootForUri(uri);
        const rootUri = root?.uri;

        // Current diagnostics from VS Code
        let diags = vscode.languages.getDiagnostics(uri);

        // Fallback to language adapter diagnostics if VS Code has none
        if (diags.length === 0) {
          const adapter = this._languageRegistry.getAdapterForUri(uri);
          if (adapter) {
            try {
              const langDiags = await adapter.getDiagnostics(uri);
              if (langDiags.length > 0) {
                diags = langDiags.map(ld => {
                  const severity =
                    ld.severity === 'error'
                      ? vscode.DiagnosticSeverity.Error
                      : ld.severity === 'warning'
                      ? vscode.DiagnosticSeverity.Warning
                      : vscode.DiagnosticSeverity.Information;
                  const range = new vscode.Range(ld.line, ld.character, ld.line, ld.character + 1);
                  const d = new vscode.Diagnostic(range, ld.message, severity);
                  d.source = ld.source;
                  return d;
                });
              }
            } catch (err) {
              this._logger.debug(`Adapter diagnostics failed for ${uri.fsPath}:`, err);
            }
          }
        }

        const fileFps: DiagnosticFingerprint[] = [];
        for (const d of diags) {
          if (d.source && d.source.toLowerCase() === 'agentguard') {
            continue;
          }
          const fp = createDiagnosticFingerprint(uri, d, rootUri);
          fileFps.push(fp);
          currentFingerprints.push(fp);
        }

        let baselineForFile = this._baselineFingerprints.get(uri.fsPath);
        if (!baselineForFile && fileFps.length > 0) {
          // If this file was unopened at startup and has diagnostics:
          // Check if the file is clean/unmodified in Git. If it is clean, these are pre-existing baseline diagnostics!
          const isClean = await this._isFileCleanInGit(uri, cancellationToken);
          if (isClean) {
            this._baselineFingerprints.set(uri.fsPath, fileFps);
            baselineForFile = fileFps;
          }
        }
        baselineFingerprintsToCheck.push(...(baselineForFile ?? []));
      }
    } else {
      // Full workspace delta analysis
      const allDiagnostics = vscode.languages.getDiagnostics();
      for (const [uri, diags] of allDiagnostics) {
        if (uri.scheme !== 'file' || isIgnoredPath(uri.fsPath)) {
          continue;
        }
        const root = this._workspaceManager.getRootForUri(uri);
        if (!root) {
          continue;
        }

        for (const d of diags) {
          if (d.source && d.source.toLowerCase() === 'agentguard') {
            continue;
          }
          currentFingerprints.push(createDiagnosticFingerprint(uri, d, root.uri));
        }
      }

      for (const fps of this._baselineFingerprints.values()) {
        baselineFingerprintsToCheck.push(...fps);
      }
    }

    const classified = correlateDiagnostics(
      baselineFingerprintsToCheck,
      currentFingerprints,
      this._isBaselineReady
    );

    const newDiags: DiagnosticFingerprint[] = [];
    const existingDiags: DiagnosticFingerprint[] = [];
    const resolvedDiags: DiagnosticFingerprint[] = [];
    const changedDiags: DiagnosticFingerprint[] = [];
    const uncertainDiags: DiagnosticFingerprint[] = [];

    for (const item of classified) {
      switch (item.classification) {
        case 'confirmed-new-diagnostic':
          newDiags.push(item.fingerprint);
          break;
        case 'existing':
          existingDiags.push(item.fingerprint);
          break;
        case 'resolved':
          resolvedDiags.push(item.fingerprint);
          break;
        case 'changed':
          changedDiags.push(item.fingerprint);
          break;
        case 'uncertain':
          uncertainDiags.push(item.fingerprint);
          break;
      }
    }

    return {
      newDiagnostics: newDiags,
      existingDiagnostics: existingDiags,
      resolvedDiagnostics: resolvedDiags,
      changedDiagnostics: changedDiags,
      uncertainDiagnostics: uncertainDiags,
      isBaselineReady: true,
    };
  }

  /**
   * Resets the baseline state.
   */
  public resetBaseline(): void {
    this._baselineFingerprints.clear();
    this._isBaselineReady = false;
    this._logger.info('Diagnostic baseline reset.');
  }

  /**
   * Updates the baseline for a specific file (e.g. after deliberate commit/save).
   */
  public updateBaselineForUri(uri: vscode.Uri): void {
    if (uri.scheme !== 'file' || isIgnoredPath(uri.fsPath)) {
      return;
    }

    const root = this._workspaceManager.getRootForUri(uri);
    const diags = vscode.languages.getDiagnostics(uri);
    const fps: DiagnosticFingerprint[] = [];

    for (const d of diags) {
      fps.push(createDiagnosticFingerprint(uri, d, root?.uri));
    }

    if (fps.length > 0) {
      this._baselineFingerprints.set(uri.fsPath, fps);
    } else {
      this._baselineFingerprints.delete(uri.fsPath);
    }
  }

  private async _isFileCleanInGit(
    uri: vscode.Uri,
    token?: vscode.CancellationToken
  ): Promise<boolean> {
    if (!this._gitService) {
      return false;
    }
    try {
      const root = this._workspaceManager.getRootForUri(uri);
      if (!root) {
        return false;
      }
      const isRepo = await this._gitService.isGitRepository(root.uri);
      if (!isRepo) {
        return false;
      }
      const status = await this._gitService.getStatusForRoot(root.uri, token);
      if (!status) {
        return false;
      }
      const targetPath = uri.fsPath.replace(/\\/g, '/');
      const isChanged = status.changedFiles.some(
        f => f.uri.fsPath.replace(/\\/g, '/') === targetPath
      );
      return !isChanged;
    } catch {
      return false;
    }
  }

  public override dispose(): void {
    this._baselineFingerprints.clear();
    super.dispose();
  }
}

