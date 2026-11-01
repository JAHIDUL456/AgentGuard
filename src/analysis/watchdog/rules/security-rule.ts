import { RefactorTracker } from '../refactor-tracker';
import {
  CodeChangeContext,
  WatchdogCategory,
  WatchdogFindingCandidate,
} from '../watchdog-types';
import { BaseWatchdogRule } from './base-rule';

export class SecurityRule extends BaseWatchdogRule {
  public readonly id = 'watchdog.security';
  public readonly name = 'Security & Injection Watchdog Rule';
  public readonly category: WatchdogCategory = 'security';
  public readonly supportedLanguages: readonly string[] = ['*'];

  private readonly _removalPatterns: readonly {
    readonly regex: RegExp;
    readonly label: string;
    readonly equivalentTerms: readonly string[];
  }[] = [
    {
      regex: /\b(?:csrfProtection|csurf|validateCsrfToken|csrf_protect)\b/i,
      label: 'CSRF protection middleware',
      equivalentTerms: ['csrfProtection', 'csurf', 'validateCsrfToken', 'csrf_protect', 'csrf'],
    },
    {
      regex: /\b(?:rateLimit\s*\(|limiter\b|throttle\s*\(|RateLimiter)\b/i,
      label: 'Rate limiting or throttling guard',
      equivalentTerms: ['rateLimit', 'limiter', 'throttle', 'RateLimiter'],
    },
    {
      regex: /\b(?:helmet\s*\(|cors\s*\()\b/i,
      label: 'Security headers / CORS middleware',
      equivalentTerms: ['helmet', 'cors'],
    },
  ];

  // Patterns detecting newly introduced unsafe code
  private readonly _unsafeAdditionPatterns: readonly {
    readonly regex: RegExp;
    readonly label: string;
  }[] = [
    {
      // SQL string interpolation / concatenation in query execution
      regex: /\b(?:db\.query|pool\.query|connection\.query|cursor\.execute|prisma\.\$queryRawUnsafe)\s*\(\s*(?:`SELECT|`INSERT|`UPDATE|`DELETE|f"SELECT|f"INSERT|f"UPDATE|f"DELETE|"[^"]*"\s*\+\s*[a-zA-Z0-9_$]+)/i,
      label: 'Unsafe SQL query with raw string interpolation or concatenation',
    },
    {
      // Cookie secure/httpOnly explicitly disabled
      regex: /\b(?:secure\s*:\s*false|httpOnly\s*:\s*false)\b/i,
      label: 'Insecure cookie flag (secure: false or httpOnly: false)',
    },
  ];

  public async inspect(
    context: CodeChangeContext
  ): Promise<readonly WatchdogFindingCandidate[]> {
    if (context.isTestFile) {
      return [];
    }

    const findings: WatchdogFindingCandidate[] = [];

    // 1. Check for removed safeguards
    const cleanRemoved = this.getCleanRemovedLines(context);
    for (const line of cleanRemoved) {
      for (const pattern of this._removalPatterns) {
        if (!pattern.regex.test(line.text)) {
          continue;
        }

        const strippedPattern = RefactorTracker.stripCommentsAndStrings(line.text);
        if (RefactorTracker.isLogicPreserved(strippedPattern, context.newContent)) {
          continue;
        }

        if (
          RefactorTracker.isEquivalentReplacementPresent(
            line.text,
            context.addedLines,
            pattern.equivalentTerms
          )
        ) {
          continue;
        }

        if (pattern.regex.test(context.newContent)) {
          continue;
        }

        findings.push({
          ruleId: this.id,
          category: this.category,
          severity: 'critical',
          confidence: 'high',
          title: `Potential Security Risk: ${pattern.label} Removed`,
          message: `A security safeguard (${pattern.label}) was removed from ${context.relativeFilePath}.`,
          evidence: `Removed security control: "${line.trimmed}" on line ${line.line + 1}.`,
          explanation:
            'Removing protections such as CSRF tokens or rate limiting weakens application defenses against cross-site request forgery and brute-force attacks.',
          line: line.line,
        });
      }
    }

    // 2. Check for newly introduced unsafe security patterns
    for (const added of context.addedLines) {
      if (RefactorTracker.isCommentOnly(added.text)) {
        continue;
      }

      for (const pattern of this._unsafeAdditionPatterns) {
        if (pattern.regex.test(added.text)) {
          findings.push({
            ruleId: this.id,
            category: this.category,
            severity: 'critical',
            confidence: 'high',
            title: `Potential Security Risk: ${pattern.label}`,
            message: `A potential security flaw (${pattern.label}) was introduced in ${context.relativeFilePath}.`,
            evidence: `Added code: "${added.trimmed}" on line ${added.line + 1}.`,
            explanation:
              'Dynamic string concatenation or interpolation in SQL queries bypasses parameterized query protection and exposes the database to SQL injection attacks.',
            line: added.line,
          });
        }
      }
    }

    return findings;
  }
}
