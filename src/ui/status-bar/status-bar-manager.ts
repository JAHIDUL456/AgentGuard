import * as vscode from 'vscode';
import { Disposable } from '../../core/disposable';
import { AgentGuardEngine } from '../../core/engine';
import { FindingManager } from '../../findings/finding-manager';
import { WorkspaceManager } from '../../workspace/workspace-manager';
import { COMMAND_SHOW_OUTPUT } from '../commands/command-ids';

export class StatusBarManager extends Disposable {
  private readonly _item: vscode.StatusBarItem;

  constructor(
    private readonly _engine: AgentGuardEngine,
    private readonly _workspaceManager: WorkspaceManager,
    private readonly _findingManager: FindingManager
  ) {
    super();

    this._item = this._register(
      vscode.window.createStatusBarItem(
        vscode.StatusBarAlignment.Right,
        100
      )
    );
    this._item.command = COMMAND_SHOW_OUTPUT;

    this._register(this._engine.onDidChangeState(() => this._update()));
    this._register(this._workspaceManager.onDidChangeRoots(() => this._update()));
    this._register(this._findingManager.onDidChangeFindings(() => this._update()));

    this._update();
    this._item.show();
  }

  public get item(): vscode.StatusBarItem {
    return this._item;
  }

  private _update(): void {
    if (!this._workspaceManager.hasWorkspace()) {
      this._item.text = '$(shield) AgentGuard: Waiting';
      this._item.tooltip = 'AgentGuard: Waiting for workspace folder';
      this._item.backgroundColor = undefined;
      return;
    }

    const state = this._engine.state;
    if (state === 'initializing') {
      this._item.text = '$(sync~spin) AgentGuard: Initializing';
      this._item.tooltip = 'AgentGuard: Initializing workspace listeners';
      this._item.backgroundColor = undefined;
      return;
    }

    if (state === 'analyzing') {
      this._item.text = '$(sync~spin) AgentGuard: Scanning';
      this._item.tooltip = 'AgentGuard: Codebase safety scan in progress';
      this._item.backgroundColor = undefined;
      return;
    }

    const stats = this._findingManager.getStats();
    if (stats.errors > 0) {
      this._item.text = `$(error) AgentGuard: ${stats.errors} error${stats.errors === 1 ? '' : 's'}`;
      this._item.tooltip = `AgentGuard detected ${stats.errors} error(s) and ${stats.warnings} warning(s). Click to view logs.`;
      this._item.backgroundColor = new vscode.ThemeColor(
        'statusBarItem.errorBackground'
      );
    } else if (stats.warnings > 0) {
      this._item.text = `$(warning) AgentGuard: ${stats.warnings} warning${stats.warnings === 1 ? '' : 's'}`;
      this._item.tooltip = `AgentGuard detected ${stats.warnings} warning(s). Click to view logs.`;
      this._item.backgroundColor = new vscode.ThemeColor(
        'statusBarItem.warningBackground'
      );
    } else {
      this._item.text = '$(shield) AgentGuard: Ready';
      const gitDesc =
        this._engine.gitAvailable && this._engine.gitRepoCount > 0
          ? 'Git integration active.'
          : 'Git fallback mode active (filesystem monitoring).';
      this._item.tooltip = `AgentGuard: Codebase safe. Monitoring active. ${gitDesc}`;
      this._item.backgroundColor = undefined;
    }
  }
}

