import {
  CodeChangeContext,
  WatchdogCategory,
  WatchdogFindingCandidate,
} from '../watchdog-types';
import { BaseWatchdogRule } from './base-rule';

export class TypeSafetyRule extends BaseWatchdogRule {
  public readonly id = 'watchdog.type-safety';
  public readonly name = 'Type Safety & Compiler Suppression Watchdog Rule';
  public readonly category: WatchdogCategory = 'type-safety';
  public readonly supportedLanguages: readonly string[] = ['*'];

  private readonly _suppressionPatterns: readonly {
    readonly regex: RegExp;
    readonly label: string;
    readonly explanation: string;
  }[] = [
    {
      regex: /\/\/\s*@ts-(?:ignore|nocheck|expect-error)\b/i,
      label: 'TypeScript compiler check suppression (@ts-ignore / @ts-nocheck)',
      explanation:
        'Suppressing TypeScript compiler errors conceals potential type mismatches, missing properties, or syntax issues.',
    },
    {
      regex: /\/\*\s*eslint-disable(?:-next-line)?\b/i,
      label: 'ESLint rule suppression comment',
      explanation:
        'Disabling linter rules can hide code quality or security lint warnings.',
    },
    {
      regex: /#\s*type:\s*ignore\b/i,
      label: 'Python type-checker suppression (# type: ignore)',
      explanation:
        'Suppressing mypy/pyright type checks conceals potential runtime AttributeError or type incompatibilities.',
    },
    {
      regex: /#\s*noqa\b/i,
      label: 'Python flake8/linter suppression (# noqa)',
      explanation:
        'Disabling linter warnings may bypass syntax or style enforcement checks.',
    },
    {
      regex: /\bas\s+any\b|<any>/,
      label: 'Unsafe cast to "any"',
      explanation:
        'Casting expressions to "any" completely strips compiler type safety and autocomplete checks.',
    },
  ];

  public async inspect(
    context: CodeChangeContext
  ): Promise<readonly WatchdogFindingCandidate[]> {
    if (context.isTestFile) {
      return [];
    }

    const findings: WatchdogFindingCandidate[] = [];

    for (const added of context.addedLines) {
      for (const pattern of this._suppressionPatterns) {
        if (pattern.regex.test(added.text)) {
          findings.push({
            ruleId: this.id,
            category: this.category,
            severity: 'review',
            confidence: 'high',
            title: `Type Safety Review: ${pattern.label} Introduced`,
            message: `A compiler or type-safety suppression directive (${pattern.label}) was added to ${context.relativeFilePath}.`,
            evidence: `Added directive: "${added.trimmed}" on line ${added.line + 1}.`,
            explanation: pattern.explanation,
            line: added.line,
          });
        }
      }
    }

    return findings;
  }
}
