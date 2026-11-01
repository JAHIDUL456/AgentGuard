import { RefactorTracker } from '../refactor-tracker';
import {
  CodeChangeContext,
  WatchdogCategory,
  WatchdogFindingCandidate,
} from '../watchdog-types';
import { BaseWatchdogRule } from './base-rule';

export class ErrorHandlingRule extends BaseWatchdogRule {
  public readonly id = 'watchdog.error-handling';
  public readonly name = 'Error Handling Watchdog Rule';
  public readonly category: WatchdogCategory = 'error-handling';
  public readonly supportedLanguages: readonly string[] = ['*'];

  private readonly _errorPatterns: readonly {
    readonly regex: RegExp;
    readonly label: string;
    readonly equivalentTerms: readonly string[];
  }[] = [
    {
      regex: /(?:^\s*\}?\s*|\b)catch\s*(?:\([a-zA-Z0-9_$\s:,]*\))?\s*\{?/i,
      label: 'catch exception handler block',
      equivalentTerms: ['catch', '.catch', 'onError', 'handleError'],
    },
    {
      regex: /^\s*except(?:\s+[a-zA-Z0-9_.,\s]+)?:\s*$/i,
      label: 'Python except exception handler block',
      equivalentTerms: ['except', 'except:'],
    },
    {
      regex: /^\s*finally\s*\{?:?\s*$/i,
      label: 'finally resource cleanup block',
      equivalentTerms: ['finally', 'defer'],
    },
    {
      regex: /\bif\s+err\s*!=\s*nil\s*\{/i,
      label: 'Go error propagation check (if err != nil)',
      equivalentTerms: ['if err != nil', 'return err'],
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
      for (const pattern of this._errorPatterns) {
        if (!pattern.regex.test(line.text)) {
          continue;
        }

        // False positive check: Was the construct moved elsewhere in the file?
        const strippedPattern = RefactorTracker.stripCommentsAndStrings(line.text);
        if (RefactorTracker.isLogicPreserved(strippedPattern, context.newContent)) {
          continue;
        }

        // False positive check: Was an equivalent catch or error handler added?
        if (
          RefactorTracker.isEquivalentReplacementPresent(
            line.text,
            context.addedLines,
            pattern.equivalentTerms
          )
        ) {
          continue;
        }

        // Check if new content still handles the error via catch/except/err != nil
        if (pattern.regex.test(context.newContent)) {
          continue;
        }

        findings.push({
          ruleId: this.id,
          category: this.category,
          severity: 'warning',
          confidence: 'high',
          title: `Potential Logic Risk: ${pattern.label} Removed`,
          message: `Error handling or resource cleanup logic (${pattern.label}) was removed from ${context.relativeFilePath}.`,
          evidence: `Removed error handler: "${line.trimmed}" on line ${line.line + 1}.`,
          explanation:
            'Stripping exception handlers or cleanup blocks can cause unhandled promise rejections, thread crashes, resource leaks, or unmonitored failures in production.',
          line: line.line,
        });
      }
    }

    return findings;
  }
}
