import {
  CodeChangeContext,
  IWatchdogRule,
  WatchdogFindingCandidate,
} from '../watchdog-types';
import { AuthenticationRule } from './authentication-rule';
import { AuthorizationRule } from './authorization-rule';
import { ErrorHandlingRule } from './error-handling-rule';
import { SecurityRule } from './security-rule';
import { SilentRegressionRule } from './silent-regression-rule';
import { TypeSafetyRule } from './type-safety-rule';
import { ValidationRule } from './validation-rule';

export class WatchdogRuleRegistry {
  private readonly _rules: IWatchdogRule[] = [];

  constructor() {
    this.registerBuiltinRules();
  }

  public registerBuiltinRules(): void {
    this._rules.push(
      new AuthenticationRule(),
      new AuthorizationRule(),
      new ValidationRule(),
      new ErrorHandlingRule(),
      new SecurityRule(),
      new TypeSafetyRule(),
      new SilentRegressionRule()
    );
  }

  public registerRule(rule: IWatchdogRule): void {
    this._rules.push(rule);
  }

  public getRules(): readonly IWatchdogRule[] {
    return this._rules;
  }

  /**
   * Runs all applicable watchdog rules on the given change context.
   */
  public async inspect(
    context: CodeChangeContext
  ): Promise<readonly WatchdogFindingCandidate[]> {
    const findings: WatchdogFindingCandidate[] = [];

    for (const rule of this._rules) {
      const applies =
        rule.supportedLanguages.includes('*') ||
        rule.supportedLanguages.includes(context.languageId);

      if (!applies) {
        continue;
      }

      try {
        const ruleFindings = await rule.inspect(context);
        findings.push(...ruleFindings);
      } catch {
        // Individual rule failure is isolated to prevent aborting other rules
      }
    }

    return findings;
  }
}

