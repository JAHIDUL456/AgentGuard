import * as vscode from 'vscode';
import { DiagnosticTracker } from '../../analysis/diagnostics/diagnostic-tracker';
import { Disposable } from '../../core/disposable';
import { AgentGuardEngine } from '../../core/engine';
import { FindingManager } from '../../findings/finding-manager';
import { WorkspaceManager } from '../../workspace/workspace-manager';
import { COMMAND_FOCUS_SIDEBAR } from '../commands/command-ids';

export class StatusBarManager extends Disposable {
  private readonly _item: vscode.StatusBarItem;

  constructor(
    private readonly _engine: AgentGuardEngine,
    private readonly _workspaceManager: WorkspaceManager,
    private readonly _findingManager: FindingManager,
    private readonly _diagnosticTracker?: DiagnosticTracker
  ) {
    super();

    this._item = this._register(
      vscode.window.createStatusBarItem(
        vscode.StatusBarAlignment.Right,
        100
      )
    );
    this._item.command = COMMAND_FOCUS_SIDEBAR;

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
      this._item.tooltip = 'AgentGuard: Waiting for workspace folder to open';
      this._item.backgroundColor = undefined;
      return;
    }

    const state = this._engine.state;
    if (state === 'initializing') {
      this._item.text = '$(sync~spin) AgentGuard: Initializing...';
      this._item.tooltip = 'AgentGuard: Initializing workspace listeners & baseline';
      this._item.backgroundColor = undefined;
      return;
    }

    if (state === 'analyzing') {
      this._item.text = '$(sync~spin) AgentGuard: Analyzing...';
      this._item.tooltip = 'AgentGuard: Codebase safety analysis in progress';
      this._item.backgroundColor = undefined;
      return;
    }

    // Check if diagnostic baseline is still settling
    if (this._diagnosticTracker && !this._diagnosticTracker.isBaselineReady) {
      this._item.text = '$(sync~spin) AgentGuard: Baseline Settling...';
      this._item.tooltip =
        'AgentGuard: Diagnostic baseline is currently settling. Pre-existing errors are suppressed.';
      this._item.backgroundColor = undefined;
      return;
    }

    const allFindings = this._findingManager.getAll();
    const isIncomplete = allFindings.some(f => f.category === 'analysis-incomplete');

    if (isIncomplete) {
      this._item.text = '$(info) AgentGuard: Analysis Incomplete';
      this._item.tooltip =
        'AgentGuard: Some checks were incomplete due to unavailable external language tooling.';
      this._item.backgroundColor = undefined;
      return;
    }

    const stats = this._findingManager.getStats();
    if (stats.errors > 0) {
      this._item.text = `$(error) AgentGuard: ${stats.errors} Issue${stats.errors === 1 ? '' : 's'} Detected`;
      this._item.tooltip = `AgentGuard detected ${stats.errors} critical issue(s) and ${stats.warnings} warning(s). Click to view in sidebar.`;
      this._item.backgroundColor = new vscode.ThemeColor(
        'statusBarItem.errorBackground'
      );
    } else if (stats.warnings > 0) {
      this._item.text = `$(warning) AgentGuard: ${stats.warnings} Issue${stats.warnings === 1 ? '' : 's'} Detected`;
      this._item.tooltip = `AgentGuard detected ${stats.warnings} warning(s). Click to view in sidebar.`;
      this._item.backgroundColor = new vscode.ThemeColor(
        'statusBarItem.warningBackground'
      );
    } else if (stats.infos > 0) {
      this._item.text = `$(info) AgentGuard: ${stats.infos} Review Item${stats.infos === 1 ? '' : 's'}`;
      this._item.tooltip = `AgentGuard detected ${stats.infos} review item(s). Click to view in sidebar.`;
      this._item.backgroundColor = undefined;
    } else {
      this._item.text = '$(shield) AgentGuard: All Clear';
      const gitDesc =
        this._engine.gitAvailable && this._engine.gitRepoCount > 0
          ? 'Git integration active.'
          : 'Git fallback mode active (filesystem monitoring).';
      this._item.tooltip = `AgentGuard: All Clear. Continuous codebase safety monitoring active. ${gitDesc} Click to open sidebar.`;
      this._item.backgroundColor = undefined;
    }
  }
}
