import * as vscode from 'vscode';
import { Disposable } from '../core/disposable';
import { ILogger } from '../core/logger';
import { Finding, FindingCategory } from '../core/types';
import { FindingFilter, FindingStats, IFindingManager } from './types';

export class FindingManager extends Disposable implements IFindingManager {
  private readonly _findingsByEngine = new Map<string, Map<string, Finding>>();
  private readonly _onDidChangeFindings = this._register(
    new vscode.EventEmitter<readonly Finding[]>()
  );

  public readonly onDidChangeFindings: vscode.Event<readonly Finding[]> =
    this._onDidChangeFindings.event;

  constructor(private readonly _logger: ILogger) {
    super();
  }

  public setFindings(sourceEngine: string, findings: readonly Finding[]): void {
    const engineMap = new Map<string, Finding>();
    for (const finding of findings) {
      engineMap.set(finding.id, finding);
    }
    this._findingsByEngine.set(sourceEngine, engineMap);
    this._logger.debug(
      `Engine '${sourceEngine}' updated findings count: ${findings.length}`
    );
    this._onDidChangeFindings.fire(this.getAll());
  }

  public clear(): void {
    if (this._findingsByEngine.size === 0) {
      return;
    }
    this._findingsByEngine.clear();
    this._logger.debug('Cleared all findings');
    this._onDidChangeFindings.fire([]);
  }

  public clearByEngine(engineId: string): void {
    if (this._findingsByEngine.delete(engineId)) {
      this._logger.debug(`Cleared findings for engine '${engineId}'`);
      this._onDidChangeFindings.fire(this.getAll());
    }
  }

  public getAll(): readonly Finding[] {
    const all: Finding[] = [];
    for (const map of this._findingsByEngine.values()) {
      for (const finding of map.values()) {
        all.push(finding);
      }
    }
    return all;
  }

  public filter(filter: FindingFilter): readonly Finding[] {
    return this.getAll().filter(f => {
      if (filter.categories && !filter.categories.includes(f.category)) {
        return false;
      }
      if (filter.severities && !filter.severities.includes(f.severity)) {
        return false;
      }
      if (filter.filePath && f.location.filePath !== filter.filePath) {
        return false;
      }
      return true;
    });
  }

  public getStats(): FindingStats {
    let errors = 0;
    let warnings = 0;
    let infos = 0;

    const byCategory: Record<FindingCategory, number> = {
      'untouched-file': 0,
      'diagnostic-regression': 0,
      'logic-risk': 0,
      'broken-dependency': 0,
    };

    for (const finding of this.getAll()) {
      if (finding.severity === 'error') {
        errors++;
      } else if (finding.severity === 'warning') {
        warnings++;
      } else {
        infos++;
      }

      byCategory[finding.category]++;
    }

    return {
      total: errors + warnings + infos,
      errors,
      warnings,
      infos,
      byCategory,
    };
  }

  public override dispose(): void {
    this._findingsByEngine.clear();
    super.dispose();
  }
}

