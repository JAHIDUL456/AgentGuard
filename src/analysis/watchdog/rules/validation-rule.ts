import { RefactorTracker } from '../refactor-tracker';
import {
  CodeChangeContext,
  WatchdogCategory,
  WatchdogFindingCandidate,
} from '../watchdog-types';
import { BaseWatchdogRule } from './base-rule';

export class ValidationRule extends BaseWatchdogRule {
  public readonly id = 'watchdog.validation';
  public readonly name = 'Validation Watchdog Rule';
  public readonly category: WatchdogCategory = 'validation';
  public readonly supportedLanguages: readonly string[] = ['*'];

  private readonly _validationPatterns: readonly {
    readonly regex: RegExp;
    readonly label: string;
    readonly equivalentTerms: readonly string[];
  }[] = [
    {
      regex: /\b(?:schema\.parse|schema\.safeParse|schema\.validate|Joi\.validate|v\.parse)\s*\(/i,
      label: 'Schema Validation execution',
      equivalentTerms: ['schema.parse', 'schema.safeParse', 'schema.validate', 'zod', 'Joi'],
    },
    {
      regex: /\b(?:validator\.(?:isEmail|isUUID|isURL|escape|trim)|DOMPurify\.sanitize|sanitizeHtml)\s*\(/i,
      label: 'Input sanitization / format validation',
      equivalentTerms: ['validator', 'sanitize', 'escape', 'DOMPurify'],
    },
    {
      regex: /\bif\s*\(\s*!(?:req\.body|body\.[a-zA-Z0-9_]+|input\.[a-zA-Z0-9_]+|payload\.[a-zA-Z0-9_]+)\s*\)/i,
      label: 'Required field or payload check',
      equivalentTerms: ['req.body', 'body.', 'input.', 'payload.'],
    },
    {
      regex: /\b(?:validateInput|validateBody|validateParams|assertValid)\s*\(/i,
      label: 'Explicit validation assertion function',
      equivalentTerms: ['validateInput', 'validateBody', 'validateParams', 'assertValid'],
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
      for (const pattern of this._validationPatterns) {
        if (!pattern.regex.test(line.text)) {
          continue;
        }

        // False positive check: Was the logic moved or refactored?
        const strippedPattern = RefactorTracker.stripCommentsAndStrings(line.text);
        if (RefactorTracker.isLogicPreserved(strippedPattern, context.newContent)) {
          continue;
        }

        // False positive check: Was an equivalent or renamed validation added?
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
          severity: 'warning',
          confidence: 'high',
          title: `Potential Logic Risk: ${pattern.label} Removed`,
          message: `Input validation or sanitization logic (${pattern.label}) was removed from ${context.relativeFilePath}.`,
          evidence: `Removed validation: "${line.trimmed}" on line ${line.line + 1}.`,
          explanation:
            'Removing schema validation, required-field assertions, or sanitizers exposes backend handlers to malformed payloads, injection vectors, or unexpected type coercions.',
          line: line.line,
        });
      }
    }

    return findings;
  }
}
