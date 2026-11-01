import * as vscode from 'vscode';
import { Finding, FindingCategory, FindingSeverity } from '../../core/types';

export class StatusTreeItem extends vscode.TreeItem {
  constructor(
    label: string,
    description: string,
    icon: vscode.ThemeIcon,
    tooltip?: string
  ) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.description = description;
    this.iconPath = icon;
    this.tooltip = tooltip ?? `${label} - ${description}`;
    this.contextValue = 'agentguard.status';
  }
}

export class CategoryTreeItem extends vscode.TreeItem {
  constructor(
    public readonly category: FindingCategory,
    public readonly findings: readonly Finding[]
  ) {
    super(
      formatCategoryName(category),
      vscode.TreeItemCollapsibleState.Expanded
    );
    this.description = `(${findings.length})`;
    this.iconPath = getCategoryIcon(category);
    this.contextValue = 'agentguard.category';
    this.tooltip = `${formatCategoryName(category)}: ${findings.length} item(s)`;
  }
}

export class FindingTreeItem extends vscode.TreeItem {
  constructor(public readonly finding: Finding) {
    super(finding.title, vscode.TreeItemCollapsibleState.None);
    this.description = `[${finding.confidence.toUpperCase()}] ${finding.location.filePath}`;
    this.iconPath = getSeverityIcon(finding.severity);
    this.tooltip = new vscode.MarkdownString(
      `**[${finding.severity.toUpperCase()}] [${finding.confidence.toUpperCase()} CONFIDENCE] ${finding.title}**\n\n` +
      `${finding.message}\n\n` +
      `**Evidence**: ${finding.evidence}\n\n` +
      `**Explanation**: ${finding.explanation}\n\n` +
      `*Source: ${finding.sourceEngine}*`
    );
    this.contextValue = 'agentguard.finding';

    if (finding.location.range) {
      this.command = {
        command: 'vscode.open',
        title: 'Open File',
        arguments: [
          finding.location.uri,
          {
            selection: finding.location.range,
          },
        ],
      };
    }
  }
}

export class InfoTreeItem extends vscode.TreeItem {
  constructor(message: string, description?: string, icon?: vscode.ThemeIcon) {
    super(message, vscode.TreeItemCollapsibleState.None);
    this.description = description;
    this.iconPath = icon ?? new vscode.ThemeIcon('info');
    this.contextValue = 'agentguard.info';
  }
}

function formatCategoryName(category: FindingCategory): string {
  switch (category) {
    case 'untouched-file':
      return 'Untouched Affected Files';
    case 'diagnostic-regression':
      return 'Diagnostic Regressions';
    case 'logic-risk':
      return 'Logic & Error Risks';
    case 'broken-dependency':
      return 'Broken Dependencies';
    case 'confirmed-new-diagnostic':
      return 'Confirmed New Diagnostics';
    case 'potentially-affected-dependency':
      return 'Potentially Affected Dependencies';
    case 'potentially-broken-contract':
      return 'Potentially Broken Contracts';
    case 'unresolved-reference':
      return 'Unresolved References';
    case 'analysis-incomplete':
      return 'Analysis Incomplete';
  }
}

function getCategoryIcon(category: FindingCategory): vscode.ThemeIcon {
  switch (category) {
    case 'untouched-file':
      return new vscode.ThemeIcon('file-submodule');
    case 'diagnostic-regression':
      return new vscode.ThemeIcon('error');
    case 'logic-risk':
      return new vscode.ThemeIcon('shield');
    case 'broken-dependency':
      return new vscode.ThemeIcon('references');
    case 'confirmed-new-diagnostic':
      return new vscode.ThemeIcon('error', new vscode.ThemeColor('errorForeground'));
    case 'potentially-affected-dependency':
      return new vscode.ThemeIcon('git-pull-request');
    case 'potentially-broken-contract':
      return new vscode.ThemeIcon('shield-x');
    case 'unresolved-reference':
      return new vscode.ThemeIcon('warning', new vscode.ThemeColor('problemsWarningIcon.foreground'));
    case 'analysis-incomplete':
      return new vscode.ThemeIcon('info');
  }
}

function getSeverityIcon(severity: FindingSeverity): vscode.ThemeIcon {
  switch (severity) {
    case 'error':
      return new vscode.ThemeIcon('error', new vscode.ThemeColor('errorForeground'));
    case 'warning':
      return new vscode.ThemeIcon('warning', new vscode.ThemeColor('problemsWarningIcon.foreground'));
    case 'info':
      return new vscode.ThemeIcon('info', new vscode.ThemeColor('problemsInfoIcon.foreground'));
  }
}

