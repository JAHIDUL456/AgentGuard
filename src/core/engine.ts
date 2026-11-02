import * as vscode from 'vscode';
import { AnalysisEngineRegistry } from '../analysis/analyzer-registry';
import { AnalysisScope } from '../analysis/types';
import { FindingManager } from '../findings/finding-manager';
import { GitService } from '../git/git-service';
import { LanguageAdapterRegistry } from '../languages/adapter-registry';
import { ChangeMonitor } from '../monitoring/change-monitor';
import { ChangeBatch } from '../monitoring/types';
import { WorkspaceManager } from '../workspace/workspace-manager';
import { Disposable } from './disposable';
import { ILogger } from './logger';
import { EngineState, EngineStatus, Finding } from './types';

export class AgentGuardEngine extends Disposable {
  private _state: EngineState = 'uninitialized';
  private _lastScanTimestamp: number | undefined;
  private _gitAvailable = false;
  private _gitRepoCount = 0;
  private _activeScanTokenSource: vscode.CancellationTokenSource | undefined;
  private _currentGeneration = 0;

  private readonly _onDidChangeState = this._register(
    new vscode.EventEmitter<EngineState>()
  );
  public readonly onDidChangeState: vscode.Event<EngineState> =
    this._onDidChangeState.event;

  private readonly _onDidScanComplete = this._register(
    new vscode.EventEmitter<readonly Finding[]>()
  );
  public readonly onDidScanComplete: vscode.Event<readonly Finding[]> =
    this._onDidScanComplete.event;

  constructor(
    private readonly _workspaceManager: WorkspaceManager,
    private readonly _changeMonitor: ChangeMonitor,
    private readonly _findingManager: FindingManager,
    private readonly _languageRegistry: LanguageAdapterRegistry,
    private readonly _analysisRegistry: AnalysisEngineRegistry,
    private readonly _gitService: GitService,
    private readonly _logger: ILogger
  ) {
    super();

    // Listen for workspace folder changes
    this._register(
      this._workspaceManager.onDidChangeRoots(roots => {
        this._logger.info(
          `Workspace roots updated (${roots.length} active root${roots.length === 1 ? '' : 's'})`
        );
        this._checkGitRoots();
      })
    );

    // Listen for incremental change batches from ChangeMonitor
    this._register(
      this._changeMonitor.onDidBatchReady(batch => {
        this._handleIncrementalChangeBatch(batch);
      })
    );
  }

  public get state(): EngineState {
    return this._state;
  }

  public get gitAvailable(): boolean {
    return this._gitAvailable;
  }

  public get gitRepoCount(): number {
    return this._gitRepoCount;
  }

  public getStatus(): EngineStatus {
    return {
      state: this._state,
      activeWorkspaceFolders: this._workspaceManager.getRoots().length,
      findingCount: this._findingManager.getAll().length,
      lastScanTimestamp: this._lastScanTimestamp,
      gitAvailable: this._gitAvailable,
      gitRepoCount: this._gitRepoCount,
    };
  }

  public async initialize(): Promise<void> {
    if (this._state !== 'uninitialized') {
      return;
    }

    this._setState('initializing');
    this._logger.info('Initializing AgentGuard engine...');

    await this._checkGitRoots();

    this._setState('ready');
    if (!this._gitAvailable || this._gitRepoCount === 0) {
      this._logger.info(
        'AgentGuard engine ready. Running in fallback mode (direct file and language monitoring active).'
      );
    } else {
      this._logger.info(
        `AgentGuard engine ready. Codebase monitoring and Git integration active (${this._gitRepoCount} repo(s)).`
      );
    }
  }

  public async scanFile(uri: vscode.Uri): Promise<readonly Finding[]> {
    const roots = this._workspaceManager.getRoots();
    return this.scanWorkspace({
      workspaceRoots: roots,
      targetUris: [uri],
    });
  }

  public async scanWorkspace(
    targetScope?: AnalysisScope,
    cancellationToken?: vscode.CancellationToken
  ): Promise<readonly Finding[]> {
    if (this._state === 'disposed') {
      return [];
    }

    // Cancel any previous in-flight scan
    if (this._activeScanTokenSource) {
      this._activeScanTokenSource.cancel();
      this._activeScanTokenSource.dispose();
      this._activeScanTokenSource = undefined;
    }

    const tokenSource = new vscode.CancellationTokenSource();
    this._activeScanTokenSource = tokenSource;
    const scanGeneration = ++this._currentGeneration;

    // Link cancellation token if provided
    let linkedRegistration: vscode.Disposable | undefined;
    if (cancellationToken) {
      linkedRegistration = cancellationToken.onCancellationRequested(() => {
        tokenSource.cancel();
      });
    }

    const roots = this._workspaceManager.getRoots();
    const scope: AnalysisScope = targetScope ?? {
      workspaceRoots: roots,
      level: 'wider',
    };

    const isWiderScan = scope.level === 'wider';
    if (isWiderScan) {
      this._setState('analyzing');
    }
    this._logger.info(`Starting codebase safety scan (gen ${scanGeneration}, level: ${scope.level ?? 'wider'})...`);

    try {
      // If Git is available, refresh Git statuses for roots
      if (this._gitAvailable && this._gitRepoCount > 0) {
        await this._gitService.getAllStatuses(tokenSource.token);
      }

      const engines = this._analysisRegistry.getEngines();
      this._logger.debug(
        `Executing ${engines.length} registered analysis engine(s)`
      );

      const allFindings: Finding[] = [];

      for (const engine of engines) {
        if (tokenSource.token.isCancellationRequested || scanGeneration !== this._currentGeneration) {
          this._logger.info(`Safety scan gen ${scanGeneration} cancelled or superseded by gen ${this._currentGeneration}.`);
          break;
        }

        try {
          const findings = await engine.analyze(scope, tokenSource.token);
          if (!tokenSource.token.isCancellationRequested && scanGeneration === this._currentGeneration) {
            this._findingManager.reconcileScope(
              engine.id,
              scope.targetUris,
              findings,
              scanGeneration
            );
            allFindings.push(...findings);
          }
        } catch (err) {
          this._logger.error(
            `Analysis engine '${engine.name}' failed during scan:`,
            err
          );
        }
      }

      if (!tokenSource.token.isCancellationRequested && scanGeneration === this._currentGeneration) {
        this._lastScanTimestamp = Date.now();
        this._onDidScanComplete.fire(this._findingManager.getAll());
        this._logger.info(
          `Safety scan complete. Total active findings: ${this._findingManager.getAll().length}`
        );
      }

      return allFindings;
    } finally {
      if (linkedRegistration) {
        linkedRegistration.dispose();
      }
      if (this._activeScanTokenSource === tokenSource) {
        this._activeScanTokenSource.dispose();
        this._activeScanTokenSource = undefined;
      }
      if (isWiderScan && !this._disposables.isDisposed) {
        this._setState('ready');
      }
    }
  }

  public override dispose(): void {
    if (this._activeScanTokenSource) {
      this._activeScanTokenSource.cancel();
      this._activeScanTokenSource.dispose();
      this._activeScanTokenSource = undefined;
    }
    this._setState('disposed');
    this._logger.info('AgentGuard engine disposed.');
    super.dispose();
  }

  private _setState(newState: EngineState): void {
    if (this._state === newState) {
      return;
    }
    this._state = newState;
    this._onDidChangeState.fire(newState);
  }

  private async _checkGitRoots(): Promise<void> {
    this._gitAvailable = await this._gitService.isGitAvailable();
    let count = 0;

    if (this._gitAvailable) {
      for (const root of this._workspaceManager.getRoots()) {
        const isRepo = await this._gitService.isGitRepository(root.uri);
        if (isRepo) {
          count++;
          this._logger.debug(`Root '${root.name}' is a valid Git repository`);
        }
      }
    }

    this._gitRepoCount = count;
  }

  private _handleIncrementalChangeBatch(batch: ChangeBatch): void {
    this._logger.debug(
      `Incremental cycle: ${batch.events.length} change(s) across ${batch.affectedUris.length} file(s)`
    );

    // Invalidate Git status cache for workspace roots containing affected files
    if (this._gitAvailable) {
      for (const uri of batch.affectedUris) {
        const root = this._workspaceManager.getRootForUri(uri);
        if (root) {
          this._gitService.invalidateCache(root.uri);
        }
      }
    }

    // Determine analysis level: Fast Local vs Incremental Dependency
    const hasMeaningfulChanges = batch.events.some(
      e =>
        e.source === 'save' ||
        e.source === 'rename' ||
        e.source === 'diagnostics' ||
        e.kind === 'deleted'
    );
    const level = hasMeaningfulChanges
      ? 'incremental-dependency'
      : 'fast-local';

    // Trigger incremental safety analysis for the affected files
    const roots = this._workspaceManager.getRoots();
    if (roots.length > 0 && batch.affectedUris.length > 0) {
      this.scanWorkspace({
        workspaceRoots: roots,
        targetUris: batch.affectedUris,
        level,
      }).catch(err => {
        this._logger.error('Automatic incremental scan failed:', err);
      });
    }
  }
}
