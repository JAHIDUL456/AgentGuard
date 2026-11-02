import * as vscode from 'vscode';
import { Finding } from '../core/types';
import { FindingStats } from '../findings/types';
import { SecretSanitizer } from './report-sanitizer';
import { ReportOptions } from './types';

export class MarkdownReporter {
  /**
   * Generates a comprehensive, offline-first Markdown safety report
   * designed for developer inspection and AI coding agent handoff.
   */
  public generateReport(
    findings: readonly Finding[],
    stats: FindingStats,
    options: ReportOptions = {}
  ): string {
    const timestamp = (options.generatedAt ?? new Date()).toISOString();
    const workspaceTitle = options.workspaceName ?? 'Current Workspace';
    const hasIssues = findings.length > 0;

    const lines: string[] = [];

    // 1. Header & Overall Status Banner
    lines.push(`# AgentGuard Codebase Safety Report`);
    lines.push(``);
    if (hasIssues) {
      lines.push(
        `> **Status**: ⚠️ **ISSUES DETECTED** (${stats.errors} Critical, ${stats.warnings} Warnings, ${stats.infos} Review)`
      );
    } else {
      lines.push(
        `> **Status**: 🛡️ **ALL CLEAR** — Zero safety regressions or broken dependencies detected.`
      );
    }
    lines.push(`> **Generated**: \`${timestamp}\` | **Workspace**: \`${workspaceTitle}\``);
    lines.push(``);

    // 2. AI Agent Handoff Instruction (Prominently placed near top for AI agent consumption)
    lines.push(`## AI Coding Agent Handoff Instruction`);
    lines.push(``);
    lines.push(
      `> **Instructions for AI Coding Assistants (ChatGPT, Claude Code, Cursor, GitHub Copilot, Windsurf):**\n>`
    );
    lines.push(
      `> "Review this report. Investigate each finding. Fix confirmed errors. Inspect potential risks before changing code. Preserve existing application behavior. Run relevant tests after making changes."`
    );
    lines.push(``);

    // 3. Workspace Information
    lines.push(`## Workspace Information`);
    lines.push(``);
    if (options.workspaceRoots && options.workspaceRoots.length > 0) {
      lines.push(`| Workspace Folder | Path |`);
      lines.push(`| --- | --- |`);
      for (const root of options.workspaceRoots) {
        lines.push(`| **${root.name}** | \`${SecretSanitizer.sanitizePath(root.path)}\` |`);
      }
      lines.push(``);
    } else {
      lines.push(`- **Target**: \`${workspaceTitle}\``);
    }

    if (options.gitInfo) {
      const gitMode =
        options.gitInfo.available && options.gitInfo.repoCount > 0
          ? `Active (${options.gitInfo.repoCount} repository root(s) tracked)`
          : `Fallback Mode (Direct file monitoring active)`;
      lines.push(`- **Monitoring Engine**: ${gitMode}`);
    }
    lines.push(``);

    // 4. Detected Languages & Available Analysis Capabilities
    lines.push(`## Detected Languages & Analysis Capabilities`);
    lines.push(``);
    if (options.languages && options.languages.length > 0) {
      lines.push(`| Language | Active Capability Level | Supported Extensions |`);
      lines.push(`| --- | --- | --- |`);
      for (const lang of options.languages) {
        lines.push(
          `| **${lang.name}** | Level ${lang.level}: ${lang.levelName} | \`${lang.extensions.join(', ')}\` |`
        );
      }
    } else {
      lines.push(`*Universal change monitoring and multi-language structural adapters active.*`);
    }
    lines.push(``);

    if (options.engines && options.engines.length > 0) {
      lines.push(`- **Active Engines**: ${options.engines.map(e => `\`${e}\``).join(', ')}`);
      lines.push(``);
    }

    // 5. Findings Summary
    lines.push(`## Summary Overview`);
    lines.push(``);
    lines.push(`| Metric | Count | Severity |`);
    lines.push(`| --- | --- | --- |`);
    lines.push(`| **Critical Errors** | ${stats.errors} | Error |`);
    lines.push(`| **Warnings** | ${stats.warnings} | Warning |`);
    lines.push(`| **Review Items** | ${stats.infos} | Info |`);
    lines.push(`| **Total Active Findings** | **${stats.total}** | - |`);
    lines.push(``);

    // 6. Categorized Findings
    if (!hasIssues) {
      lines.push(`## Safety Findings`);
      lines.push(``);
      lines.push(
        `> 🛡️ **Zero safety issues detected.** Codebase is in healthy condition. All analyzed code changes, imports, and security safeguards are intact.`
      );
      lines.push(``);
    } else {
      const compilerDiagnostics = findings.filter(
        f => f.category === 'confirmed-new-diagnostic' || f.category === 'diagnostic-regression'
      );
      const blastRadiusFindings = findings.filter(
        f =>
          f.category === 'untouched-file' ||
          f.category === 'potentially-affected-dependency' ||
          f.category === 'potentially-broken-contract' ||
          f.category === 'unresolved-reference'
      );
      const watchdogFindings = findings.filter(f => f.category === 'logic-risk');
      const otherFindings = findings.filter(
        f =>
          !compilerDiagnostics.includes(f) &&
          !blastRadiusFindings.includes(f) &&
          !watchdogFindings.includes(f)
      );

      lines.push(`## Detailed Findings`);
      lines.push(``);

      let counter = 1;

      // Group A: New Compiler / Type / Syntax Diagnostics
      if (compilerDiagnostics.length > 0) {
        lines.push(`### 1. New Compiler & Type Diagnostics (${compilerDiagnostics.length})`);
        lines.push(``);
        lines.push(
          `These compiler, syntax, or type errors were introduced by recent changes and were not present in the baseline snapshot:`
        );
        lines.push(``);
        for (const f of compilerDiagnostics) {
          lines.push(this._formatFindingCard(counter++, f));
        }
      }

      // Group B: Potentially Affected Untouched Files (Blast Radius)
      if (blastRadiusFindings.length > 0) {
        lines.push(
          `### 2. Potentially Affected Untouched Files (${blastRadiusFindings.length})`
        );
        lines.push(``);
        lines.push(
          `These untouched files depend on symbols, interfaces, or exports that were deleted, renamed, or modified in changed files:`
        );
        lines.push(``);
        for (const f of blastRadiusFindings) {
          lines.push(this._formatFindingCard(counter++, f));
        }
      }

      // Group C: Logic & Critical Safety Risks (Watchdog)
      if (watchdogFindings.length > 0) {
        lines.push(`### 3. Logic & Safety Risks (${watchdogFindings.length})`);
        lines.push(``);
        lines.push(
          `Suspicious structural removal or weakening of authentication, authorization, validation, error handling, or security assertions:`
        );
        lines.push(``);
        for (const f of watchdogFindings) {
          lines.push(this._formatFindingCard(counter++, f));
        }
      }

      // Group D: Other findings
      if (otherFindings.length > 0) {
        lines.push(`### 4. Other Codebase Findings (${otherFindings.length})`);
        lines.push(``);
        for (const f of otherFindings) {
          lines.push(this._formatFindingCard(counter++, f));
        }
      }
    }

    // 7. Analysis Limitations
    lines.push(`## Analysis Limitations & Boundaries`);
    lines.push(``);
    lines.push(`- **Offline-First Heuristics**: AgentGuard runs 100% locally with zero cloud APIs. Complex runtime reflection, monkey-patching, or dynamic remote RPCs may require runtime integration tests.`);
    lines.push(`- **Baseline Differential Scoping**: Pre-existing compiler diagnostics outside active change deltas are suppressed to minimize noise.`);
    lines.push(`- **Tooling Availability**: Full semantic verification depends on installed language tooling (e.g., TypeScript language server, Rust analyzer, Go gopls). In their absence, AST heuristics ensure high safety coverage.`);
    lines.push(``);

    // 8. Recommended Next Actions
    lines.push(`## Recommended Next Actions`);
    lines.push(``);
    if (hasIssues) {
      lines.push(`1. **Fix Confirmed Compiler & Type Regressions**: Resolve newly introduced compiler errors before proceeding.`);
      lines.push(`2. **Inspect Logic & Safety Warnings**: Review removed authentication, authorization, or error-handling blocks to verify intentionality.`);
      lines.push(`3. **Update Untouched Dependent Callers**: Update signatures or imports in untouched files flagged by Blast Radius analysis.`);
      lines.push(`4. **Run Automated Test Suite**: Execute unit and integration tests for all affected modules.`);
    } else {
      lines.push(`1. **Safe to Proceed**: Codebase changes pass all static safety, contract, and logic checks.`);
      lines.push(`2. **Run Tests**: Execute project test suite prior to staging and committing.`);
    }
    lines.push(``);

    lines.push(`---`);
    lines.push(
      `*Report automatically generated by [AgentGuard](https://github.com/jahidul456/agentguard) — Offline-first Codebase Safety.*`
    );

    return lines.join('\n');
  }

  private _formatFindingCard(index: number, finding: Finding): string {
    const lines: string[] = [];
    const locationStr = finding.location.range
      ? `${finding.location.filePath}:${finding.location.range.start.line + 1}`
      : finding.location.filePath;

    const sanitizedEvidence = SecretSanitizer.sanitize(finding.evidence);
    const sanitizedMessage = SecretSanitizer.sanitize(finding.message);
    const sanitizedExplanation = SecretSanitizer.sanitize(finding.explanation);

    lines.push(
      `#### ${index}. [${finding.severity.toUpperCase()}] [${finding.confidence.toUpperCase()} CONFIDENCE] ${finding.title}`
    );
    lines.push(``);
    lines.push(`- **File Location**: \`${locationStr}\``);
    lines.push(`- **Category**: \`${finding.category}\``);
    if (finding.evidenceClassification) {
      lines.push(`- **Evidence Classification**: \`${finding.evidenceClassification}\``);
    }
    if (finding.ruleId) {
      lines.push(`- **Rule ID**: \`${finding.ruleId}\``);
    }
    lines.push(`- **Source Engine**: \`${finding.sourceEngine}\``);
    lines.push(`- **Description**: ${sanitizedMessage}`);
    lines.push(`- **Evidence**: \`${sanitizedEvidence}\``);
    lines.push(`- **Explanation**: ${sanitizedExplanation}`);
    if (finding.suggestedRemediation) {
      lines.push(`- **Suggested Remediation**: ${SecretSanitizer.sanitize(finding.suggestedRemediation)}`);
    }
    lines.push(``);

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
