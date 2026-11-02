import * as vscode from 'vscode';
import { Finding } from '../../core/types';
import { FindingManager } from '../../findings/finding-manager';
import { COMMAND_COPY_FIX_PROMPT, COMMAND_OPEN_PROBLEMS_PANEL } from '../commands/command-ids';
import { NavigationService } from '../navigation/navigation-service';

export class FindingHoverProvider implements vscode.HoverProvider {
  constructor(private readonly _findingManager: FindingManager) {}

  public provideHover(
    document: vscode.TextDocument,
    position: vscode.Position,
    _token: vscode.CancellationToken
  ): vscode.ProviderResult<vscode.Hover> {
    if (document.uri.scheme !== 'file') {
      return undefined;
    }

    const findings = this._findingManager.getFindingsForUri(document.uri);
    if (findings.length === 0) {
      return undefined;
    }

    // Find findings matching the hovered position
    const matchingFindings = findings.filter(f => {
      if (!f.location.range) {
        return false;
      }
      return (
        position.line >= f.location.range.start.line &&
        position.line <= f.location.range.end.line
      );
    });

    if (matchingFindings.length === 0) {
      return undefined;
    }

    const md = new vscode.MarkdownString();
    md.isTrusted = true;
    md.supportHtml = true;

    for (let i = 0; i < matchingFindings.length; i++) {
      const f = matchingFindings[i]!;
      if (i > 0) {
        md.appendMarkdown('\n\n---\n\n');
      }

      const severityBadge =
        f.severity === 'error'
          ? '🔴 CRITICAL'
          : f.severity === 'warning'
          ? '🟡 WARNING'
          : 'ℹ️ REVIEW';

      // 1. Clean Title with Severity Indicator
      md.appendMarkdown(`**$(shield) AgentGuard: ${f.title}** • \`${severityBadge}\`\n\n`);

      // 2. Short, professional explanation
      md.appendMarkdown(`${f.explanation}\n\n`);

      // 3. Concise Remediation or Review guidance
      if (f.suggestedRemediation) {
        const prefix = f.severity === 'error' ? '**Fix:**' : '**Review:**';
        md.appendMarkdown(`${prefix} ${f.suggestedRemediation}\n\n`);
      }

      // 4. Quick Actions (Copy AI Fix Prompt & Open in Details Panel)
      const encodedId = encodeURIComponent(JSON.stringify(f.id));
      md.appendMarkdown(
        `[$(sparkle) Copy AI Fix Prompt](command:${COMMAND_COPY_FIX_PROMPT}?${encodedId}) • [Open in Panel](command:${COMMAND_OPEN_PROBLEMS_PANEL}?${encodedId})`
      );
    }

    const primaryFinding = matchingFindings[0];
    const primaryRange = primaryFinding
      ? NavigationService.resolveAccurateRange(document, primaryFinding)
      : undefined;

    return new vscode.Hover(md, primaryRange);
  }
}
