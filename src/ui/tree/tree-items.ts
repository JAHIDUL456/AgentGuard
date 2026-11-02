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
    icon?: vscode.ThemeIcon,
    collapsibleState: vscode.TreeItemCollapsibleState = vscode.TreeItemCollapsibleState.Expanded
  ) {
    super(label, collapsibleState);
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

    // Compact, responsive path formatting for narrow sidebars
    const filePath = finding.location.filePath;
    const pathSegments = filePath.split(/[/\\]/);
    const compactLocation =
      pathSegments.length > 2
        ? `${pathSegments.slice(-2).join('/')}${lineSuffix}`
        : `${filePath}${lineSuffix}`;

    this.description = compactLocation;
    this.iconPath = getSeverityIcon(finding.severity);

    // Clean, structured Markdown tooltip
    const md = new vscode.MarkdownString();
    md.isTrusted = true;
    md.supportHtml = true;

    const severityUpper = finding.severity.toUpperCase();
    const confidenceUpper = finding.confidence.toUpperCase();

    md.appendMarkdown(`### ${finding.title}\n\n`);
    md.appendMarkdown(`**File**: \`${finding.location.filePath}${lineSuffix}\`\n\n`);
    md.appendMarkdown(`**Severity**: \`${severityUpper}\` • **Confidence**: \`${confidenceUpper}\`\n\n`);
    md.appendMarkdown(`---\n\n`);
    md.appendMarkdown(`**Explanation**:\n${finding.explanation}\n\n`);
    md.appendMarkdown(`**Evidence**:\n\`\`\`\n${finding.evidence}\n\`\`\`\n\n`);
    md.appendMarkdown(`*Category: ${finding.category} • Engine: ${finding.sourceEngine}*`);

    this.tooltip = md;
    this.contextValue = `agentguard.finding.${finding.severity}`;

    // Clickable navigation command: Opens the file and navigates directly to line selection
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
    super(adapter.displayName, vscode.TreeItemCollapsibleState.None);
    const levelName = formatCapabilityLevel(adapter.capabilityLevel);
    const extStr = adapter.fileExtensions.slice(0, 3).join(', ');
    this.description = `Level ${adapter.capabilityLevel} (${extStr})`;
    this.iconPath = new vscode.ThemeIcon('file-code');

    const md = new vscode.MarkdownString();
    md.isTrusted = true;
    md.appendMarkdown(`**${adapter.displayName} Adapter**\n\n`);
    md.appendMarkdown(`- **Capability Level**: Level ${adapter.capabilityLevel} (${levelName})\n`);
    md.appendMarkdown(`- **Extensions**: \`${adapter.fileExtensions.join(', ')}\`\n`);
    md.appendMarkdown(`- **Capabilities**: \`${adapter.capabilities.join(', ')}\`\n`);
    if (adapter.projectManifests.length > 0) {
      md.appendMarkdown(`- **Manifests**: \`${adapter.projectManifests.join(', ')}\`\n`);
    }
    if (adapter.knownLimitations.length > 0) {
      md.appendMarkdown(`\n**Declared Limitations**:\n`);
      for (const lim of adapter.knownLimitations) {
        md.appendMarkdown(`- ${lim}\n`);
      }
    }
    this.tooltip = md;
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
