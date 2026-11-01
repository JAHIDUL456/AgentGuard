import { RefactorTracker } from '../refactor-tracker';
import {
  CodeChangeContext,
  WatchdogCategory,
  WatchdogFindingCandidate,
} from '../watchdog-types';
import { BaseWatchdogRule } from './base-rule';

export class AuthenticationRule extends BaseWatchdogRule {
  public readonly id = 'watchdog.authentication';
  public readonly name = 'Authentication Watchdog Rule';
  public readonly category: WatchdogCategory = 'authentication';
  public readonly supportedLanguages: readonly string[] = ['*'];

  private readonly _authPatterns: readonly {
    readonly regex: RegExp;
    readonly label: string;
    readonly equivalentTerms: readonly string[];
  }[] = [
    {
      regex: /\b(?:jwt\.verify|verifyToken|validateToken|verifyJwt|decodeAndVerify)\s*\(/i,
      label: 'JWT / Token verification call',
      equivalentTerms: ['jwt.verify', 'verifyToken', 'validateToken', 'authenticateToken', 'checkAuth', 'authMiddleware', 'requireAuth'],
    },
    {
      regex: /\b(?:passport\.authenticate|authMiddleware|requireAuth|ensureAuthenticated|isAuthenticated|checkAuth)\b/i,
      label: 'Authentication middleware or guard',
      equivalentTerms: ['passport.authenticate', 'authMiddleware', 'requireAuth', 'ensureAuthenticated', 'isAuthenticated', 'checkAuth', 'AuthGuard', 'validateToken', 'verifyToken'],
    },
    {
      regex: /@(?:login_required|jwt_required|auth_required|UseGuards\s*\(\s*AuthGuard\s*\)|PreAuthorize|Authorize)\b/i,
      label: 'Authentication decorator or annotation',
      equivalentTerms: ['login_required', 'jwt_required', 'AuthGuard', 'Authorize', 'PreAuthorize'],
    },
    {
      regex: /\b(?:validateSession|checkSession|session\.isValid|req\.isAuthenticated\s*\(\s*\))\b/i,
      label: 'Session validation check',
      equivalentTerms: ['validateSession', 'checkSession', 'session.isValid', 'req.isAuthenticated'],
    },
    {
      regex: /\b(?:Depends\s*\(\s*(?:get_current_user|auth_required|get_authenticated_user)\s*\))\b/i,
      label: 'FastAPI / Python authentication dependency',
      equivalentTerms: ['get_current_user', 'auth_required', 'get_authenticated_user'],
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
      for (const pattern of this._authPatterns) {
        if (!pattern.regex.test(line.text)) {
          continue;
        }

        // False positive check: Was the construct moved elsewhere in the file?
        const strippedPattern = RefactorTracker.stripCommentsAndStrings(line.text);
        if (RefactorTracker.isLogicPreserved(strippedPattern, context.newContent)) {
          continue;
        }

        // False positive check: Was an equivalent or renamed auth term added?
        if (
          RefactorTracker.isEquivalentReplacementPresent(
            line.text,
            context.addedLines,
            pattern.equivalentTerms
          )
        ) {
          continue;
        }

        // If the new content still contains the match (e.g. refactored call site), skip
        if (pattern.regex.test(context.newContent)) {
          continue;
        }

        findings.push({
          ruleId: this.id,
          category: this.category,
          severity: 'critical',
          confidence: 'high',
          title: `Potential Security Risk: ${pattern.label} Removed`,
          message: `An authentication safeguard (${pattern.label}) appears to have been removed from ${context.relativeFilePath}.`,
          evidence: `Removed safeguard: "${line.trimmed}" on line ${line.line + 1}.`,
          explanation:
            'Removing authentication checks, token validation, or auth middleware exposes application entry points to unauthenticated callers without identity verification.',
          line: line.line,
        });
      }
    }

    return findings;
  }
}
