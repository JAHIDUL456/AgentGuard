import * as vscode from 'vscode';
import { Disposable } from '../../core/disposable';
import { AgentGuardEngine } from '../../core/engine';
import { ILogger } from '../../core/logger';
import { FindingManager } from '../../findings/finding-manager';
import { MarkdownReporter } from '../../reporting/markdown-reporter';
import { WorkspaceManager } from '../../workspace/workspace-manager';
import {
  COMMAND_CLEAR_FINDINGS,
  COMMAND_FOCUS_SIDEBAR,
  COMMAND_GENERATE_REPORT,
  COMMAND_SCAN_WORKSPACE,
  COMMAND_SHOW_OUTPUT,
} from './command-ids';

export class CommandHandler extends Disposable {
  constructor(
    private readonly _engine: AgentGuardEngine,
    private readonly _workspaceManager: WorkspaceManager,
    private readonly _findingManager: FindingManager,
    private readonly _markdownReporter: MarkdownReporter,
    private readonly _logger: ILogger
  ) {
    super();
    this._registerCommands();
  }

  private _registerCommands(): void {
    // Scan Workspace
    this._register(
      vscode.commands.registerCommand(COMMAND_SCAN_WORKSPACE, async () => {
        if (!this._workspaceManager.hasWorkspace()) {
          vscode.window.showInformationMessage(
            'AgentGuard: No workspace folder is open to scan.'
          );
          return;
        }

        await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: 'AgentGuard: Scanning codebase...',
            cancellable: false,
          },
          async () => {
            const findings = await this._engine.scanWorkspace();
            if (findings.length === 0) {
              vscode.window.showInformationMessage(
                'AgentGuard: Scan complete. Zero safety issues detected.'
              );
            } else {
              vscode.window.showWarningMessage(
                `AgentGuard: Scan complete. Found ${findings.length} issue(s).`
              );
            }
          }
        );
      })
    );

    // Show Output
    this._register(
      vscode.commands.registerCommand(COMMAND_SHOW_OUTPUT, () => {
        this._logger.show();
      })
    );

    // Generate Report
    this._register(
      vscode.commands.registerCommand(COMMAND_GENERATE_REPORT, async () => {
        const findings = this._findingManager.getAll();
        const stats = this._findingManager.getStats();
        const roots = this._workspaceManager.getRoots();
        const workspaceName = roots.map(r => r.name).join(', ') || undefined;

        const report = this._markdownReporter.generateReport(findings, stats, {
          workspaceName,
          generatedAt: new Date(),
        });

        await this._markdownReporter.openReportInEditor(report);
      })
    );

    // Clear Findings
    this._register(
      vscode.commands.registerCommand(COMMAND_CLEAR_FINDINGS, () => {
        this._findingManager.clear();
        vscode.window.showInformationMessage('AgentGuard: Findings cleared.');
      })
    );

    // Focus Sidebar
    this._register(
      vscode.commands.registerCommand(COMMAND_FOCUS_SIDEBAR, async () => {
        await vscode.commands.executeCommand('agentguard.findingsView.focus');
      })
    );
  }
}

