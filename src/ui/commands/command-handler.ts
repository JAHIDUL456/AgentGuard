import * as path from 'path';
import * as vscode from 'vscode';
import { Disposable } from '../../core/disposable';
import { AgentGuardEngine } from '../../core/engine';
import { ILogger } from '../../core/logger';
import { Finding } from '../../core/types';
import { InteractiveDemoManager } from '../../demo/interactive-demo';
import { FindingManager } from '../../findings/finding-manager';
import { ChangeMonitor } from '../../monitoring/change-monitor';
import { MarkdownReporter } from '../../reporting/markdown-reporter';
import { WorkspaceManager } from '../../workspace/workspace-manager';
import { NavigationService } from '../navigation/navigation-service';
import { IssuesPanelProvider } from '../panel/issues-panel-provider';
import {
  COMMAND_APPLY_QUICK_FIX,
  COMMAND_CLEAR_FINDINGS,
  COMMAND_COPY_FIX_PROMPT,
  COMMAND_EXPORT_JSON_REPORT,
  COMMAND_FOCUS_SIDEBAR,
  COMMAND_GENERATE_REPORT,
  COMMAND_IGNORE_FINDING,
  COMMAND_OPEN_FINDING_LOCATION,
  COMMAND_OPEN_PROBLEMS_PANEL,
  COMMAND_RECHECK_FINDING,
  COMMAND_SCAN_WORKSPACE,
  COMMAND_SHOW_FINDING_DIFF,
  COMMAND_SHOW_OUTPUT,
  COMMAND_TOGGLE_MONITORING,
  COMMAND_TRY_INTERACTIVE_DEMO,
} from './command-ids';

export class CommandHandler extends Disposable {
  private _panelProvider?: IssuesPanelProvider;
  private _changeMonitor?: ChangeMonitor;
  private _demoManager?: InteractiveDemoManager;

  constructor(
    private readonly _engine: AgentGuardEngine,
    private readonly _workspaceManager: WorkspaceManager,
    private readonly _findingManager: FindingManager,
    private readonly _markdownReporter: MarkdownReporter,
    private readonly _logger: ILogger,
    changeMonitor?: ChangeMonitor,
    panelProvider?: IssuesPanelProvider,
    demoManager?: InteractiveDemoManager
  ) {
    super();
    this._changeMonitor = changeMonitor;
    this._panelProvider = panelProvider;
    this._demoManager = demoManager;
    this._registerCommands();
  }

  public setDemoManager(demoManager: InteractiveDemoManager): void {
    this._demoManager = demoManager;
  }

  public setPanelProvider(panelProvider: IssuesPanelProvider): void {
    this._panelProvider = panelProvider;
  }

  public setChangeMonitor(changeMonitor: ChangeMonitor): void {
    this._changeMonitor = changeMonitor;
  }

  private _registerCommands(): void {
    // 1. Scan Workspace
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
            title: 'AgentGuard: Checking codebase safety...',
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

    // 2. Show Output Log
    this._register(
      vscode.commands.registerCommand(COMMAND_SHOW_OUTPUT, () => {
        this._logger.show();
      })
    );

    // 3. Generate Markdown Safety Report
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

    // 4. Export JSON Report
    this._register(
      vscode.commands.registerCommand(COMMAND_EXPORT_JSON_REPORT, async () => {
        const findings = this._findingManager.getAll();
        const stats = this._findingManager.getStats();
        const payload = {
          agentguardVersion: '2.0.0',
          generatedAt: new Date().toISOString(),
          stats,
          findings: findings.map(f => ({
            id: f.id,
            ruleId: f.ruleId,
            category: f.category,
            severity: f.severity,
            confidence: f.confidence,
            evidenceClassification: f.evidenceClassification,
            title: f.title,
            message: f.message,
            explanation: f.explanation,
            evidence: f.evidence,
            location: {
              filePath: f.location.filePath,
              line: f.location.range ? f.location.range.start.line + 1 : undefined,
            },
            suggestedRemediation: f.suggestedRemediation,
            sourceEngine: f.sourceEngine,
          })),
        };

        const jsonStr = JSON.stringify(payload, null, 2);
        const doc = await vscode.workspace.openTextDocument({
          content: jsonStr,
          language: 'json',
        });
        await vscode.window.showTextDocument(doc, { preview: true });
      })
    );

    // 5. Copy AI Fix Prompt
    this._register(
      vscode.commands.registerCommand(
        COMMAND_COPY_FIX_PROMPT,
        async (findingOrId?: string | { id: string } | Finding) => {
          let finding: Finding | undefined;
          if (typeof findingOrId === 'string') {
            finding = this._findingManager.getAll().find(f => f.id === findingOrId) ??
                      this._findingManager.getResolvedHistory().find(f => f.id === findingOrId);
          } else if (findingOrId && typeof findingOrId === 'object') {
            if ('id' in findingOrId && typeof (findingOrId as { id: unknown }).id === 'string') {
              const id = (findingOrId as { id: string }).id;
              finding =
                this._findingManager.getAll().find(f => f.id === id) ??
                this._findingManager.getResolvedHistory().find(f => f.id === id) ??
                (findingOrId as Finding);
            }
          }

          if (!finding) {
            const all = this._findingManager.getAll();
            finding = all[0];
          }

          if (!finding) {
            vscode.window.showInformationMessage(
              'AgentGuard: No active findings to copy prompt for.'
            );
            return;
          }

          const prompt = CommandHandler.buildAiFixPrompt(finding);
          await vscode.env.clipboard.writeText(prompt);
          vscode.window.showInformationMessage(
            `AgentGuard: AI Fix Prompt for '${finding.title}' copied to clipboard.`
          );
        }
      )
    );

    // 6. Clear Findings
    this._register(
      vscode.commands.registerCommand(COMMAND_CLEAR_FINDINGS, () => {
        this._findingManager.clear();
        vscode.window.showInformationMessage('AgentGuard: Findings cleared.');
      })
    );

    // 7. Focus Sidebar View
    this._register(
      vscode.commands.registerCommand(COMMAND_FOCUS_SIDEBAR, async () => {
        await vscode.commands.executeCommand('agentguard.findingsView.focus');
      })
    );

    // 8. Open Problems Panel (Dedicated Bottom Panel)
    this._register(
      vscode.commands.registerCommand(
        COMMAND_OPEN_PROBLEMS_PANEL,
        async (findingId?: string) => {
          await vscode.commands.executeCommand('agentguard.issuesView.focus');
          if (findingId && this._panelProvider) {
            this._panelProvider.selectFinding(findingId);
          }
        }
      )
    );

    // 9. Pause / Resume Monitoring
    this._register(
      vscode.commands.registerCommand(COMMAND_TOGGLE_MONITORING, () => {
        if (this._changeMonitor) {
          const nextState = !this._changeMonitor.isEnabled();
          this._changeMonitor.setEnabled(nextState);
          vscode.window.showInformationMessage(
            `AgentGuard: Automated monitoring ${nextState ? 'resumed' : 'paused'}.`
          );
        }
      })
    );

    // 10. Open Finding Location (Exact Source Navigation)
    this._register(
      vscode.commands.registerCommand(
        COMMAND_OPEN_FINDING_LOCATION,
        async (findingOrId?: string | Finding) => {
          let finding: Finding | undefined;
          if (typeof findingOrId === 'string') {
            finding = this._findingManager.getAll().find(f => f.id === findingOrId) ??
                      this._findingManager.getResolvedHistory().find(f => f.id === findingOrId);
          } else if (findingOrId && typeof findingOrId === 'object' && 'id' in findingOrId) {
            finding = findingOrId;
          }
          if (finding) {
            await NavigationService.openFinding(finding);
          }
        }
      )
    );

    // 11. View Change / Diff
    this._register(
      vscode.commands.registerCommand(
        COMMAND_SHOW_FINDING_DIFF,
        async (finding?: Finding) => {
          if (!finding) {
            return;
          }
          await NavigationService.openFinding(finding);
        }
      )
    );

    // 12. Recheck Issue Live
    this._register(
      vscode.commands.registerCommand(
        COMMAND_RECHECK_FINDING,
        async (finding?: Finding) => {
          if (!finding) {
            return;
          }
          await vscode.window.withProgress(
            {
              location: vscode.ProgressLocation.Notification,
              title: `AgentGuard: Rechecking '${finding.title}'...`,
            },
            async () => {
              await this._engine.scanFile(finding.location.uri);
            }
          );
        }
      )
    );

    // 13. Ignore / Dismiss Issue
    this._register(
      vscode.commands.registerCommand(
        COMMAND_IGNORE_FINDING,
        async (finding?: Finding) => {
          if (!finding) {
            return;
          }
          const choice = await vscode.window.showWarningMessage(
            `Ignore finding '${finding.title}' for this session?`,
            'Ignore Finding',
            'Cancel'
          );
          if (choice === 'Ignore Finding') {
            this._findingManager.updateFinding({
              ...finding,
              status: 'suppressed',
            });
            vscode.window.showInformationMessage(
              `AgentGuard: Finding '${finding.title}' ignored.`
            );
          }
        }
      )
    );

    // 14. Apply Available Quick Fix (With Explicit User Authorization)
    this._register(
      vscode.commands.registerCommand(
        COMMAND_APPLY_QUICK_FIX,
        async (finding?: Finding) => {
          if (!finding || !finding.suggestedRemediation) {
            vscode.window.showInformationMessage(
              'AgentGuard: No automated quick fix available for this finding.'
            );
            return;
          }

          const choice = await vscode.window.showWarningMessage(
            `Apply recommended remediation?\n\n"${finding.suggestedRemediation}"\n\nto ${path.basename(finding.location.filePath)}?`,
            { modal: true },
            'Apply Fix',
            'Cancel'
          );

          if (choice !== 'Apply Fix') {
            return;
          }

          await this._applyRemediation(finding);
        }
      )
    );

    // 15. Try Interactive Safety Demo
    this._register(
      vscode.commands.registerCommand(
        COMMAND_TRY_INTERACTIVE_DEMO,
        async () => {
          if (!this._demoManager) {
            vscode.window.showInformationMessage('Interactive demo manager is initializing...');
            return;
          }
          await this._demoManager.runDemo();
        }
      )
    );
  }

  private async _applyRemediation(finding: Finding): Promise<void> {
    try {
      const doc = await vscode.workspace.openTextDocument(finding.location.uri);
      const editor = await vscode.window.showTextDocument(doc);
      const range = NavigationService.resolveAccurateRange(doc, finding);

      if (!range) {
        vscode.window.showErrorMessage('Unable to determine accurate source location for quick fix.');
        return;
      }

      // Safe code remediation
      if (finding.ruleId === 'silent-regression-removed-await') {
        const lineText = doc.lineAt(range.start.line).text;
        // Insert 'await ' before the function call
        const match = lineText.match(/^(\s*)([a-zA-Z0-9_$.]+\s*\()/);
        if (match) {
          const edit = new vscode.WorkspaceEdit();
          edit.insert(finding.location.uri, new vscode.Position(range.start.line, match[1]?.length ?? 0), 'await ');
          await vscode.workspace.applyEdit(edit);
          vscode.window.showInformationMessage('AgentGuard: Restored missing `await` keyword.');
          return;
        }
      }

      vscode.window.showInformationMessage(
        `AgentGuard: Opened ${path.basename(finding.location.filePath)}. Please apply remediation: ${finding.suggestedRemediation}`
      );
    } catch (err) {
      vscode.window.showErrorMessage(`AgentGuard Quick Fix failed: ${err}`);
    }
  }

  public static buildAiFixPrompt(finding: Finding): string {
    const lineNum = finding.location.range
      ? `${finding.location.filePath}:${finding.location.range.start.line + 1}`
      : finding.location.filePath;

    const lines = [
      `# AgentGuard Codebase Safety Fix Request`,
      ``,
      `AgentGuard static safety analysis detected a regression or safety risk in this codebase.`,
      `Please inspect the evidence and fix the issue while preserving surrounding logic and interfaces.`,
      ``,
      `- **File Location**: \`${lineNum}\``,
      `- **Rule ID**: \`${finding.ruleId ?? finding.category}\``,
      `- **Severity**: \`${finding.severity.toUpperCase()}\``,
      `- **Evidence Classification**: \`${finding.evidenceClassification ?? 'structural-regression'}\``,
      `- **Issue**: ${finding.title}`,
      `- **Explanation**: ${finding.explanation}`,
      `- **Evidence**:`,
      `\`\`\``,
      finding.evidence,
      `\`\`\``,
    ];

    if (finding.suggestedRemediation) {
      lines.push(`- **Suggested Remediation**: ${finding.suggestedRemediation}`);
    }

    lines.push(``);
    lines.push(`## Action Instructions`);
    lines.push(`1. Address the root cause identified in the evidence.`);
    lines.push(`2. Do not introduce breaking contract changes to untouched dependent files.`);
    lines.push(`3. Ensure all tests and types continue to compile cleanly.`);

    return lines.join('\n');
  }
}
