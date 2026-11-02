import { RefactorTracker } from '../refactor-tracker';
import {
  CodeChangeContext,
  WatchdogCategory,
  WatchdogFindingCandidate,
} from '../watchdog-types';
import { BaseWatchdogRule } from './base-rule';

export class SilentRegressionRule extends BaseWatchdogRule {
  public readonly id = 'watchdog.silent-regression';
  public readonly name = 'Silent Behavior Regression Watchdog Rule';
  public readonly category: WatchdogCategory = 'silent-regression';
  public readonly supportedLanguages: readonly string[] = ['*'];

  public async inspect(
    context: CodeChangeContext
  ): Promise<readonly WatchdogFindingCandidate[]> {
    if (context.isTestFile) {
      return [];
    }

    const findings: WatchdogFindingCandidate[] = [];
    const cleanRemoved = this.getCleanRemovedLines(context);

    // 1. Detect Removed Await on Function Calls:
    // e.g. - await user.save();
    //      + user.save();
    for (const rem of cleanRemoved) {
      const awaitMatch = rem.text.match(/\bawait\s+([a-zA-Z0-9_$.]+)\s*\(/);
      if (awaitMatch && awaitMatch[1]) {
        const callee = awaitMatch[1];
        // Check if an added line calls this callee without await
        for (const added of context.addedLines) {
          if (RefactorTracker.isCommentOnly(added.text)) {
            continue;
          }
          if (
            added.text.includes(`${callee}(`) &&
            !added.text.includes(`await ${callee}(`) &&
            !added.text.includes(`await `) &&
            !added.text.trim().startsWith('return ')
          ) {
            findings.push({
              ruleId: this.id,
              category: this.category,
              severity: 'warning',
              confidence: 'high',
              title: `Silent Behavior Risk: 'await' Keyword Removed on '${callee}()'`,
              message: `Asynchronous call '${callee}()' is executed without 'await' in ${context.relativeFilePath}.`,
              evidence: `Removed: "${rem.trimmed}" -> Added: "${added.trimmed}".`,
              explanation:
                'Calling an async function or promise without "await" creates an unmonitored floating promise. The operation executes asynchronously in the background, ignoring return values and uncaught rejections.',
              line: added.line,
            });
            break;
          }
        }
      }
    }

    // 2. Detect Newly Introduced Empty Catch Blocks:
    // e.g. catch (err) {}
    for (const added of context.addedLines) {
      if (RefactorTracker.isCommentOnly(added.text)) {
        continue;
      }
      const emptyCatchMatch = added.text.match(
        /\bcatch\s*(?:\([a-zA-Z0-9_$,\s]*\))?\s*\{\s*\}/
      );
      if (emptyCatchMatch) {
        findings.push({
          ruleId: this.id,
          category: this.category,
          severity: 'warning',
          confidence: 'high',
          title: 'Silent Error Risk: Newly Introduced Empty Catch Block',
          message: `An empty catch block that swallows exceptions was added to ${context.relativeFilePath}.`,
          evidence: `Added empty catch: "${added.trimmed}" on line ${added.line + 1}.`,
          explanation:
            'Swallowing exceptions silently in an empty catch block conceals fatal runtime failures, network timeouts, or corrupted state from monitoring and telemetry.',
          line: added.line,
        });
      }
    }

    // 3. Detect Removed Transaction Rollback:
    // e.g. - await tx.rollback();
    for (const rem of cleanRemoved) {
      if (/\b(?:rollback|abortTransaction)\s*\(/.test(rem.text)) {
        const stripped = RefactorTracker.stripCommentsAndStrings(rem.text);
        if (!RefactorTracker.isLogicPreserved(stripped, context.newContent)) {
          findings.push({
            ruleId: this.id,
            category: this.category,
            severity: 'critical',
            confidence: 'high',
            title: 'Critical Silent Risk: Database Transaction Rollback Removed',
            message: `Database transaction rollback handler was removed from ${context.relativeFilePath}.`,
            evidence: `Removed rollback: "${rem.trimmed}" on line ${rem.line + 1}.`,
            explanation:
              'Omitting transaction rollback on failure leaves database connections in tainted transactions, holds locks indefinitely, or risks partial uncommitted writes.',
            line: rem.line,
          });
        }
      }
    }

    // 4. Detect Removed Error Propagation (throw or Promise.reject):
    for (const rem of cleanRemoved) {
      if (/\b(?:throw\s+(?:err|error|new\s+\w+Error)|return\s+Promise\.reject)\b/.test(rem.text)) {
        const stripped = RefactorTracker.stripCommentsAndStrings(rem.text);
        if (!RefactorTracker.isLogicPreserved(stripped, context.newContent)) {
          // Check if re-throw was added elsewhere
          const hasAddedThrow = context.addedLines.some(a => /\bthrow\b/.test(a.text));
          if (!hasAddedThrow) {
            findings.push({
              ruleId: this.id,
              category: this.category,
              severity: 'review',
              confidence: 'medium',
              title: 'Behavior Review: Explicit Error Propagation Removed',
              message: `Error re-throw or rejection propagation was removed from ${context.relativeFilePath}.`,
              evidence: `Removed: "${rem.trimmed}" on line ${rem.line + 1}.`,
              explanation:
                'Removing error re-throw alters the error-handling contract and may silently mask failures from caller boundaries.',
              line: rem.line,
            });
          }
        }
      }
    }

    // 5. Detect Removed Optional Chaining / Null Safety:
    // e.g. - const id = user?.profile?.id;
    //      + const id = user.profile.id;
    for (const rem of cleanRemoved) {
      const optChainMatch = rem.text.match(/\b([a-zA-Z0-9_$]+)\?\.[a-zA-Z0-9_$]+/);
      if (optChainMatch && optChainMatch[1]) {
        const varName = optChainMatch[1];
        for (const added of context.addedLines) {
          if (RefactorTracker.isCommentOnly(added.text)) {
            continue;
          }
          if (
            added.text.includes(`${varName}.`) &&
            !added.text.includes(`${varName}?.`) &&
            !context.newContent.includes(`if (${varName})`) &&
            !context.newContent.includes(`if (!${varName})`)
          ) {
            findings.push({
              ruleId: this.id,
              category: this.category,
              severity: 'review',
              confidence: 'medium',
              title: `Silent Behavior Risk: Optional Chaining Removed on '${varName}'`,
              message: `Optional chaining '${varName}?.' was replaced with direct property access in ${context.relativeFilePath}.`,
              evidence: `Removed: "${rem.trimmed}" -> Added: "${added.trimmed}".`,
              explanation:
                `Accessing properties directly without optional chaining (?.) or prior null checks will throw unhandled TypeError if '${varName}' is null or undefined at runtime.`,
              line: added.line,
            });
            break;
          }
        }
      }
    }

    return findings;
  }
}

