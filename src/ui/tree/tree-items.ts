import * as vscode from 'vscode';
import { Finding, FindingSeverity } from '../../core/types';
import { CapabilityLevel, ILanguageAdapter } from '../../languages/types';

export class SectionTreeItem extends vscode.TreeItem {
  constructor(
    label: string,
    public readonly sectionId:
      | 'status'
      | 'critical'
      | 'warnings'
      | 'review'
      | 'languages'
      | 'recent-activity',
    count?: number,
    icon?: vscode.ThemeIcon
  ) {
    super(label, vscode.TreeItemCollapsibleState.Expanded);
    if (count !== undefined) {
      this.description = `(${count})`;
    }
    this.iconPath = icon;
    this.contextValue = `agentguard.section.${sectionId}`;
  }
}

export class StatusItem extends vscode.TreeItem {
  constructor(
    label: string,
    description: string,
    icon: vscode.ThemeIcon,
    tooltip?: string
  ) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.description = description;
    this.iconPath = icon;
    this.tooltip = tooltip ?? `${label}: ${description}`;
    this.contextValue = 'agentguard.status-item';
  }
}

export class FindingTreeItem extends vscode.TreeItem {
  constructor(public readonly finding: Finding) {
    super(finding.title, vscode.TreeItemCollapsibleState.None);

    const lineSuffix =
      finding.location.range !== undefined
        ? `:${finding.location.range.start.line + 1}`
        : '';

    this.description = `[${finding.confidence.toUpperCase()}] ${finding.location.filePath}${lineSuffix}`;
    this.iconPath = getSeverityIcon(finding.severity);

    const md = new vscode.MarkdownString();
    md.isTrusted = true;
    md.appendMarkdown(
      `### [${finding.severity.toUpperCase()}] [${finding.confidence.toUpperCase()} CONFIDENCE] ${finding.title}\n\n`
    );
    md.appendMarkdown(`**File**: \`${finding.location.filePath}${lineSuffix}\`\n\n`);
    md.appendMarkdown(`**Explanation**: ${finding.explanation}\n\n`);
    md.appendMarkdown(`**Evidence**: \`${finding.evidence}\`\n\n`);
    md.appendMarkdown(`*Source Engine: ${finding.sourceEngine} • Category: ${finding.category}*`);

    this.tooltip = md;
    this.contextValue = 'agentguard.finding';

    // Clickable navigation command: Opens the file and navigates directly to the line
    if (finding.location.range) {
      this.command = {
        command: 'vscode.open',
        title: 'Navigate to Safety Finding',
        arguments: [
          finding.location.uri,
          {
            selection: finding.location.range,
          },
        ],
      };
    } else {
      this.command = {
        command: 'vscode.open',
        title: 'Open File',
        arguments: [finding.location.uri],
      };
    }
  }
}

export class LanguageTreeItem extends vscode.TreeItem {
  constructor(adapter: ILanguageAdapter) {
    const levelName = formatCapabilityLevel(adapter.capabilityLevel);
    super(adapter.displayName, vscode.TreeItemCollapsibleState.None);
    this.description = `Level ${adapter.capabilityLevel}: ${levelName}`;
    this.iconPath = new vscode.ThemeIcon('file-code');
    this.tooltip = new vscode.MarkdownString(
      `**${adapter.displayName} Adapter**\n\n` +
      `- **Capability Level**: Level ${adapter.capabilityLevel} (${levelName})\n` +
      `- **Extensions**: \`${adapter.fileExtensions.join(', ')}\`\n` +
      `- **Capabilities**: \`${adapter.capabilities.join(', ')}\``
    );
    this.contextValue = 'agentguard.language';
  }
}

export class ActivityTreeItem extends vscode.TreeItem {
  constructor(
    label: string,
    description: string,
    icon: vscode.ThemeIcon,
    tooltip?: string
  ) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.description = description;
    this.iconPath = icon;
    this.tooltip = tooltip ?? `${label}: ${description}`;
    this.contextValue = 'agentguard.activity';
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

export function formatCapabilityLevel(level: CapabilityLevel): string {
  switch (level) {
    case CapabilityLevel.Level1_ChangeMonitoring:
      return 'Change Monitoring';
    case CapabilityLevel.Level2_StructuralAnalysis:
      return 'Structural AST Analysis';
    case CapabilityLevel.Level3_DependencyAnalysis:
      return 'Dependency & Reference Analysis';
    case CapabilityLevel.Level4_DiagnosticsIntegration:
      return 'Diagnostics Integration';
    case CapabilityLevel.Level5_DeepSemanticAnalysis:
      return 'Deep Semantic Analysis';
  }
}
