import * as vscode from 'vscode';
import { AnalysisEngineRegistry } from '../analysis/analyzer-registry';
import { AnalysisScope } from '../analysis/types';
import { FindingManager } from '../findings/finding-manager';
import { GitService } from '../git/git-service';
import { LanguageAdapterRegistry } from '../languages/adapter-registry';
import { ChangeMonitor } from '../monitoring/change-monitor';
import { WorkspaceManager } from '../workspace/workspace-manager';
import { Disposable } from './disposable';
import { ILogger } from './logger';
import { EngineState, EngineStatus, Finding } from './types';

export class AgentGuardEngine extends Disposable {
  private _state: EngineState = 'uninitialized';
  private _lastScanTimestamp: number | undefined;

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

    // Listen for file changes from ChangeMonitor
    this._register(
      this._changeMonitor.onDidChangeFiles(events => {
        this._logger.debug(
          `Received ${events.length} change events from monitor`
        );
        // Foundation hook for incremental analysis in Stage 2+
      })
    );
  }

  public get state(): EngineState {
    return this._state;
  }

  public getStatus(): EngineStatus {
    return {
      state: this._state,
      activeWorkspaceFolders: this._workspaceManager.getRoots().length,
      findingCount: this._findingManager.getAll().length,
      lastScanTimestamp: this._lastScanTimestamp,
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
    this._logger.info('AgentGuard engine ready. Codebase monitoring active.');
  }

  public async scanWorkspace(
    targetScope?: AnalysisScope
  ): Promise<readonly Finding[]> {
    if (this._state === 'disposed') {
      return [];
    }

    const previousState = this._state;
    this._setState('analyzing');
    this._logger.info('Starting codebase safety scan...');

    try {
      const roots = this._workspaceManager.getRoots();
      const scope: AnalysisScope = targetScope ?? {
        workspaceRoots: roots,
      };

      const engines = this._analysisRegistry.getEngines();
      this._logger.debug(
        `Executing ${engines.length} registered analysis engine(s)`
      );

      const allFindings: Finding[] = [];

      for (const engine of engines) {
        try {
          const findings = await engine.analyze(scope);
          this._findingManager.setFindings(engine.id, findings);
          allFindings.push(...findings);
        } catch (err) {
          this._logger.error(
            `Analysis engine '${engine.name}' failed during scan:`,
            err
          );
        }
      }

      this._lastScanTimestamp = Date.now();
      this._onDidScanComplete.fire(allFindings);
      this._logger.info(
        `Safety scan complete. Total findings: ${allFindings.length}`
      );

      return allFindings;
    } finally {
      if (!this._disposables.isDisposed) {
        this._setState('ready');
      }
    }
  }

  public override dispose(): void {
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
    for (const root of this._workspaceManager.getRoots()) {
      const info = await this._gitService.getRepositoryInfo(root.uri);
      if (info) {
        this._logger.debug(`Root '${root.name}' is a valid Git repository`);
      }
    }
  }
}
