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

  public addFinding(finding: Finding): void {
    let engineMap = this._findingsByEngine.get(finding.sourceEngine);
    if (!engineMap) {
      engineMap = new Map<string, Finding>();
      this._findingsByEngine.set(finding.sourceEngine, engineMap);
    }
    engineMap.set(finding.id, finding);
    this._onDidChangeFindings.fire(this.getAll());
  }

  public updateFinding(finding: Finding): void {
    this.addFinding(finding);
  }

  public removeFinding(id: string): void {
    let removed = false;
    for (const map of this._findingsByEngine.values()) {
      if (map.delete(id)) {
        removed = true;
      }
    }
    if (removed) {
      this._onDidChangeFindings.fire(this.getAll());
    }
  }

  public removeFindingsForUri(uri: vscode.Uri): void {
    let removed = false;
    const targetPath = uri.fsPath;
    for (const map of this._findingsByEngine.values()) {
      for (const [id, finding] of map) {
        if (finding.location.uri.fsPath === targetPath) {
          map.delete(id);
          removed = true;
        }
      }
    }
    if (removed) {
      this._logger.debug(`Removed stale findings for file: ${uri.fsPath}`);
      this._onDidChangeFindings.fire(this.getAll());
    }
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

  public clearByWorkspace(rootUri: vscode.Uri): void {
    let removed = false;
    const rootPath = rootUri.fsPath;
    for (const map of this._findingsByEngine.values()) {
      for (const [id, finding] of map) {
        if (
          finding.location.workspaceRootUri?.fsPath === rootPath ||
          finding.location.uri.fsPath.startsWith(rootPath)
        ) {
          map.delete(id);
          removed = true;
        }
      }
    }
    if (removed) {
      this._logger.debug(`Cleared findings for workspace: ${rootPath}`);
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
    return this._deduplicate(all);
  }

  public getFindingsForUri(uri: vscode.Uri): readonly Finding[] {
    return this.getAll().filter(f => f.location.uri.fsPath === uri.fsPath);
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
      if (
        filter.workspaceRootUri &&
        f.location.workspaceRootUri?.fsPath !== filter.workspaceRootUri.fsPath
      ) {
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
      'confirmed-new-diagnostic': 0,
      'potentially-affected-dependency': 0,
      'potentially-broken-contract': 0,
      'unresolved-reference': 0,
      'analysis-incomplete': 0,
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

  private _deduplicate(findings: readonly Finding[]): readonly Finding[] {
    const deduplicated = new Map<string, Finding>();

    for (const finding of findings) {
      const lineKey = finding.location.range
        ? `${finding.location.range.start.line}:${finding.location.range.start.character}`
        : 'file-level';
      const topic = this._normalizeTopic(finding);
      const dedupeKey = `${finding.location.uri.fsPath}::${lineKey}::${topic}`;

      const existing = deduplicated.get(dedupeKey);
      if (!existing) {
        deduplicated.set(dedupeKey, finding);
      } else {
        const existingRank = this._getFindingRank(existing);
        const newRank = this._getFindingRank(finding);

        if (newRank > existingRank) {
          deduplicated.set(dedupeKey, finding);
        }
      }
    }

    return Array.from(deduplicated.values());
  }

  private _getFindingRank(finding: Finding): number {
    const severityScore =
      finding.severity === 'error' ? 30 : finding.severity === 'warning' ? 20 : 10;
    const confidenceScore =
      finding.confidence === 'high' ? 3 : finding.confidence === 'medium' ? 2 : 1;
    return severityScore + confidenceScore;
  }

  private _normalizeTopic(finding: Finding): string {
    if (finding.metadata?.watchdogCategory) {
      return String(finding.metadata.watchdogCategory);
    }
    const titleMatch = finding.title.match(/\[([A-Z0-9_-]+)\]/i);
    if (titleMatch && titleMatch[1]) {
      return titleMatch[1].toLowerCase();
    }
    return finding.category;
  }

  public override dispose(): void {
    this._findingsByEngine.clear();
    super.dispose();
  }
}

