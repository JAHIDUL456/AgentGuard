import * as vscode from 'vscode';
import { Finding } from '../core/types';
import { FindingStats } from '../findings/types';
import { ReportOptions } from './types';

export class MarkdownReporter {
  public generateReport(
    findings: readonly Finding[],
    stats: FindingStats,
    options: ReportOptions = {}
  ): string {
    const timestamp = (options.generatedAt ?? new Date()).toISOString();
    const workspaceTitle = options.workspaceName
      ? ` for **${options.workspaceName}**`
      : '';

    const lines: string[] = [
      `# AgentGuard Codebase Safety Report`,
      ``,
      `> Generated on: \`${timestamp}\`${workspaceTitle}`,
      ``,
      `## Summary Overview`,
      ``,
      `| Metric | Count |`,
      `| --- | --- |`,
      `| **Total Findings** | ${stats.total} |`,
      `| **Errors** | ${stats.errors} |`,
      `| **Warnings** | ${stats.warnings} |`,
      `| **Info Items** | ${stats.infos} |`,
      ``,
      `### Findings by Category`,
      ``,
      `| Category | Count |`,
      `| --- | --- |`,
      `| Untouched Affected Files | ${stats.byCategory['untouched-file']} |`,
      `| Diagnostic / Syntax Regressions | ${stats.byCategory['diagnostic-regression']} |`,
      `| Logic & Error-Handling Risks | ${stats.byCategory['logic-risk']} |`,
      `| Broken Dependencies | ${stats.byCategory['broken-dependency']} |`,
      ``,
    ];

    if (findings.length === 0) {
      lines.push(
        `## Detailed Findings`,
        ``,
        `> :shield: **Zero safety issues detected.** Codebase is in healthy condition.`,
        ``
      );
    } else {
      lines.push(`## Detailed Findings`, ``);

      for (let i = 0; i < findings.length; i++) {
        const finding = findings[i]!;
        const locationStr = finding.location.range
          ? `${finding.location.filePath}:${finding.location.range.start.line + 1}`
          : finding.location.filePath;

        lines.push(
          `### ${i + 1}. [${finding.severity.toUpperCase()}] ${finding.title}`,
          ``,
          `- **Category**: \`${finding.category}\``,
          `- **Location**: \`${locationStr}\``,
          `- **Source**: \`${finding.sourceEngine}\``,
          `- **Description**: ${finding.message}`,
          ``
        );
      }
    }

    lines.push(
      `---`,
      `*Report created by [AgentGuard](https://github.com/) - Offline-first Codebase Safety.*`
    );

    return lines.join('\n');
  }

  public async openReportInEditor(content: string): Promise<void> {
    const doc = await vscode.workspace.openTextDocument({
      content,
      language: 'markdown',
    });
    await vscode.window.showTextDocument(doc, { preview: true });
  }
}

