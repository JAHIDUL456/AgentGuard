import { RefactorTracker } from '../refactor-tracker';
import {
  CodeChangeContext,
  WatchdogCategory,
  WatchdogFindingCandidate,
} from '../watchdog-types';
import { BaseWatchdogRule } from './base-rule';

export class AuthorizationRule extends BaseWatchdogRule {
  public readonly id = 'watchdog.authorization';
  public readonly name = 'Authorization Watchdog Rule';
  public readonly category: WatchdogCategory = 'authorization';
  public readonly supportedLanguages: readonly string[] = ['*'];

  private readonly _authzPatterns: readonly {
    readonly regex: RegExp;
    readonly label: string;
    readonly equivalentTerms: readonly string[];
  }[] = [
    {
      regex: /\b(?:user|req\.user|currentUser|claims)\.(?:roles?|hasRole|hasPermission|isAdmin|is_admin|canAccess)\b/i,
      label: 'Authorization role or permission verification branch',
      equivalentTerms: ['roles', 'hasRole', 'hasPermission', 'isAdmin', 'is_admin', 'canAccess', 'checkPermission'],
    },
    {
      regex: /\b(?:assertAdmin|requireAdmin|requireRole|checkPermission|enforcePolicy|authorize)\s*\(/i,
      label: 'Access-control assertion or policy call',
      equivalentTerms: ['assertAdmin', 'requireAdmin', 'requireRole', 'checkPermission', 'enforcePolicy', 'authorize'],
    },
    {
      regex: /\b(?:ownerId|userId|createdById)\s*===\s*(?:user\.id|userId|currentUserId)\b/i,
      label: 'Resource ownership access check',
      equivalentTerms: ['ownerId', 'userId', 'createdById'],
    },
    {
      regex: /@(?:roles_accepted|has_role|require_permission|Roles|AuthorizeRoles)\b/i,
      label: 'Authorization role-guard decorator',
      equivalentTerms: ['roles_accepted', 'has_role', 'require_permission', 'Roles', 'AuthorizeRoles'],
    },
  ];

  public async inspect(
    context: CodeChangeContext
  ): Promise<readonly WatchdogFindingCandidate[]> {
    if (context.isTestFile) {
      return [];
    }

    const findings: WatchdogFindingCandidate[] = [];
    const cleanRemoved = this.getCleanRemovedLines(context);

    for (const line of cleanRemoved) {
      for (const pattern of this._authzPatterns) {
        if (!pattern.regex.test(line.text)) {
          continue;
        }

        // False positive check: Was the logic moved or refactored?
        const strippedPattern = RefactorTracker.stripCommentsAndStrings(line.text);
        if (RefactorTracker.isLogicPreserved(strippedPattern, context.newContent)) {
          continue;
        }

        // False positive check: Was an equivalent or renamed role check added?
        if (
          RefactorTracker.isEquivalentReplacementPresent(
            line.text,
            context.addedLines,
            pattern.equivalentTerms
          )
        ) {
          continue;
        }

        // If the new content still contains the match, skip
        if (pattern.regex.test(context.newContent)) {
          continue;
        }

        findings.push({
          ruleId: this.id,
          category: this.category,
          severity: 'critical',
          confidence: 'high',
          title: `Potential Security Risk: ${pattern.label} Removed`,
          message: `An authorization or permission guard (${pattern.label}) appears to have been stripped from ${context.relativeFilePath}.`,
          evidence: `Removed authorization check: "${line.trimmed}" on line ${line.line + 1}.`,
          explanation:
            'Removing authorization checks, role boundaries, or ownership validation may allow unauthorized users to perform privileged operations or access private tenant data.',
          line: line.line,
        });
      }
    }

    return findings;
  }
}
