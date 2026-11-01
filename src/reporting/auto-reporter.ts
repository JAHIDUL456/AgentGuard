import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { Disposable } from '../core/disposable';
import { AgentGuardEngine } from '../core/engine';
import { ILogger } from '../core/logger';
import { FindingManager } from '../findings/finding-manager';
import { LanguageAdapterRegistry } from '../languages/adapter-registry';
import { formatCapabilityLevel } from '../ui/tree/tree-items';
import { debounce, DebouncedFunction } from '../utils/debounce';
import { WorkspaceManager } from '../workspace/workspace-manager';
import { MarkdownReporter } from './markdown-reporter';
import { ReportLanguageInfo, ReportOptions, ReportWorkspaceFolder } from './types';

export class AutoReportManager extends Disposable {
  private readonly _debouncedUpdate: DebouncedFunction<[]>;
  private readonly _lastReportHashByRoot = new Map<string, string>();
  private _isDisposed = false;

  constructor(
    private readonly _engine: AgentGuardEngine,
    private readonly _workspaceManager: WorkspaceManager,
    private readonly _findingManager: FindingManager,
    private readonly _languageRegistry: LanguageAdapterRegistry,
    private readonly _reporter: MarkdownReporter,
    private readonly _logger: ILogger,
    debounceMs: number = 400
  ) {
    super();

    this._debouncedUpdate = debounce(
      () => {
        void this._writeReports();
      },
      debounceMs
    );

    // Subscribe to finding mutations
    this._register(
      this._findingManager.onDidChangeFindings(() => {
        this.scheduleReport();
      })
    );

    // Subscribe to scan completions
    this._register(
      this._engine.onDidScanComplete(() => {
        this.scheduleReport();
      })
    );
  }

  /**
   * Schedules a debounced automatic report write.
   */
  public scheduleReport(): void {
    if (this._isDisposed) {
      return;
    }
    this._debouncedUpdate();
  }

  /**
   * Immediately flushes and writes the report without debouncing.
   */
  public async forceUpdate(): Promise<void> {
    if (this._isDisposed) {
      return;
    }
    this._debouncedUpdate.cancel();
    await this._writeReports();
  }

  private async _writeReports(): Promise<void> {
    if (this._isDisposed) {
      return;
    }

    const roots = this._workspaceManager.getRoots();
    if (roots.length === 0) {
      return;
    }

    const allFindings = this._findingManager.getAll();
    const stats = this._findingManager.getStats();

    // Prepare language information
    const adapters = this._languageRegistry.getAdapters();
    const languages: ReportLanguageInfo[] = adapters.map(a => ({
      id: a.id,
      name: a.displayName,
      level: a.capabilityLevel,
      levelName: formatCapabilityLevel(a.capabilityLevel),
      extensions: a.fileExtensions,
    }));

    const workspaceFolders: ReportWorkspaceFolder[] = roots.map(r => ({
      name: r.name,
      path: r.uri.fsPath,
    }));

    const gitInfo = {
      available: this._engine.gitAvailable,
      repoCount: this._engine.gitRepoCount,
    };

    const engines = [
      'Diagnostic Delta Engine',
      'Untouched File Blast-Radius Engine',
      'Critical Logic & Safety Watchdog',
    ];

    for (const root of roots) {
      try {
        // Filter findings specific to this workspace root if in a multi-root setup
        const rootFindings =
          roots.length === 1
            ? allFindings
            : allFindings.filter(
                f =>
                  f.location.workspaceRootUri?.fsPath === root.uri.fsPath ||
                  f.location.uri.fsPath.startsWith(root.uri.fsPath)
              );

        const options: ReportOptions = {
          workspaceName: root.name,
          workspaceRoots: workspaceFolders,
          generatedAt: new Date(),
          languages,
          gitInfo,
          engines,
        };

        const markdownContent = this._reporter.generateReport(
          rootFindings,
          stats,
          options
        );

        // Check if report body semantically changed (excluding dynamic timestamp line)
        const semanticBody = this._stripTimestamp(markdownContent);
        const contentHash = crypto
          .createHash('sha256')
          .update(semanticBody)
          .digest('hex');

        const prevHash = this._lastReportHashByRoot.get(root.uri.fsPath);
        if (prevHash === contentHash) {
          // Content has not changed, avoid unnecessary disk write
          this._logger.debug(
            `Report content unchanged for root '${root.name}', skipping disk write.`
          );
          continue;
        }

        await this._writeReportFile(root.uri.fsPath, markdownContent);
        this._lastReportHashByRoot.set(root.uri.fsPath, contentHash);
        this._logger.debug(
          `Updated automatic safety report at ${root.name}/.vscode/agentguard-report.md`
        );
      } catch (err: unknown) {
        const error = err as Error & { code?: string };
        if (
          error.code === 'EACCES' ||
          error.code === 'EPERM' ||
          error.code === 'EROFS'
        ) {
          this._logger.warn(
            `Workspace root '${root.name}' is read-only. Automatic report write skipped: ${error.message}`
          );
        } else {
          this._logger.warn(
            `Failed to write automatic report for root '${root.name}':`,
            err
          );
        }
      }
    }
  }

  /**
   * Safely writes the report to .vscode/agentguard-report.md using atomic rename.
   */
  private async _writeReportFile(
    rootPath: string,
    content: string
  ): Promise<void> {
    const vscodeDir = path.join(rootPath, '.vscode');
    await fs.promises.mkdir(vscodeDir, { recursive: true });

    const targetFile = path.join(vscodeDir, 'agentguard-report.md');
    const tempFile = path.join(vscodeDir, '.agentguard-report.tmp');

    // Atomic write pattern: write to hidden temp file, then atomic rename
    await fs.promises.writeFile(tempFile, content, 'utf8');
    await fs.promises.rename(tempFile, targetFile);
  }

  /**
   * Strips the dynamic timestamp line to compare semantic report content.
   */
  private _stripTimestamp(markdown: string): string {
    return markdown.replace(/> \*\*Generated\*\*: `[^`]+` \| /g, '');
  }

  public override dispose(): void {
    this._isDisposed = true;
    this._debouncedUpdate.cancel();
    this._lastReportHashByRoot.clear();
    super.dispose();
  }
}
