import * as vscode from 'vscode';
import { Disposable } from '../core/disposable';
import { ILogger } from '../core/logger';
import { Finding, FindingCategory } from '../core/types';
import { FindingFilter, FindingStats, IFindingManager } from './types';

export class FindingManager extends Disposable implements IFindingManager {
  private readonly _findingsByEngine = new Map<string, Map<string, Finding>>();
  private readonly _latestGenerationByEngine = new Map<string, number>();
  private readonly _resolvedHistory: Finding[] = [];
  private readonly _onDidChangeFindings = this._register(
    new vscode.EventEmitter<readonly Finding[]>()
  );

  public readonly onDidChangeFindings: vscode.Event<readonly Finding[]> =
    this._onDidChangeFindings.event;

  constructor(private readonly _logger: ILogger) {
    super();
  }

  public setFindings(sourceEngine: string, findings: readonly Finding[]): void {
    this.reconcileScope(sourceEngine, undefined, findings);
  }

  /**
   * Reconciles findings for an analysis scope, automatically resolving fixed issues,
   * preserving untouched findings, updating ranges on line shifts, and rejecting stale generations.
   */
  public reconcileScope(
    sourceEngine: string,
    targetUris: readonly vscode.Uri[] | undefined,
    findings: readonly Finding[],
    generation?: number
  ): void {
    // 1. Stale-result rejection
    if (generation !== undefined) {
      const latest = this._latestGenerationByEngine.get(sourceEngine) ?? -1;
      if (generation < latest) {
        this._logger.debug(
          `[FindingManager] Stale result rejected for engine '${sourceEngine}': generation ${generation} < latest ${latest}`
        );
        return;
      }
      this._latestGenerationByEngine.set(sourceEngine, generation);
    }

    let engineMap = this._findingsByEngine.get(sourceEngine);
    if (!engineMap) {
      engineMap = new Map<string, Finding>();
      this._findingsByEngine.set(sourceEngine, engineMap);
    }

    // 2. Full scan reconciliation
    if (!targetUris || targetUris.length === 0) {
      // Find resolved findings
      const newIds = new Set(findings.map(f => f.id));
      for (const [id, oldFinding] of engineMap) {
        if (!newIds.has(id)) {
          this._resolvedHistory.push({
            ...oldFinding,
            status: 'resolved',
            verificationState: 'verified-clean',
          });
        }
      }

      engineMap.clear();
      for (const f of findings) {
        engineMap.set(f.id, f);
      }

      this._logger.debug(
        `Engine '${sourceEngine}' full reconcile: ${findings.length} active finding(s)`
      );
      this._onDidChangeFindings.fire(this.getAll());
      return;
    }

    // 3. Incremental scope reconciliation: only replace/resolve findings on target files
    const targetPathSet = new Set(targetUris.map(u => u.fsPath.replace(/\\/g, '/')));

    // Collect previous findings on the target files
    const previousOnTarget: Finding[] = [];
    for (const [id, finding] of engineMap) {
      const fPath = finding.location.uri.fsPath.replace(/\\/g, '/');
      if (targetPathSet.has(fPath)) {
        previousOnTarget.push(finding);
        engineMap.delete(id);
      }
    }

    // Add new findings for target files
    for (const f of findings) {
      engineMap.set(f.id, f);
    }

    // Detect resolved findings that were on target files but no longer exist
    const newFindingKeys = new Set(
      findings.map(f => this._computeStableIdentity(f))
    );

    for (const prev of previousOnTarget) {
      const prevKey = this._computeStableIdentity(prev);
      if (!newFindingKeys.has(prevKey)) {
        this._resolvedHistory.push({
          ...prev,
          status: 'resolved',
          verificationState: 'verified-clean',
        });
        this._logger.debug(
          `[FindingManager] Finding verified resolved: '${prev.title}' in ${prev.location.filePath}`
        );
      }
    }

    this._logger.debug(
      `Engine '${sourceEngine}' scoped reconcile for ${targetUris.length} file(s): ${engineMap.size} total active`
    );
    this._onDidChangeFindings.fire(this.getAll());
  }

  /**
   * Computes a line-shift-independent stable identity for tracking findings across edits.
   */
  private _computeStableIdentity(f: Finding): string {
    const normTopic = this._normalizeTopic(f);
    const relPath = f.location.filePath.replace(/\\/g, '/');
    return `${f.sourceEngine}::${f.ruleId || f.category}::${relPath}::${normTopic}`;
  }

  public migrateUri(oldUri: vscode.Uri, newUri: vscode.Uri): void {
    const oldPath = oldUri.fsPath;
    const newPath = newUri.fsPath;
    let migrated = false;

    for (const map of this._findingsByEngine.values()) {
      for (const [id, finding] of Array.from(map.entries())) {
        if (finding.location.uri.fsPath === oldPath) {
          map.delete(id);
          const updatedFinding: Finding = {
            ...finding,
            id: finding.id.replace(oldPath, newPath),
            location: {
              ...finding.location,
              uri: newUri,
              filePath: finding.location.filePath.replace(oldPath, newPath),
            },
          };
          map.set(updatedFinding.id, updatedFinding);
          migrated = true;
        }
      }
    }

    if (migrated) {
      this._logger.debug(`Migrated findings from ${oldPath} to ${newPath}`);
      this._onDidChangeFindings.fire(this.getAll());
    }
  }

  public getResolvedHistory(): readonly Finding[] {
    return this._resolvedHistory;
  }

  public clearResolvedHistory(): void {
    this._resolvedHistory.length = 0;
  }

  public addFinding(finding: Finding): void {
    let engineMap = this._findingsByEngine.get(finding.sourceEngine);
    if (!engineMap) {
      engineMap = new Map<string, Finding>();
      this._findingsByEngine.set(finding.sourceEngine, engineMap);
    }

    // Check for existing finding with same line-shift stable identity
    const newKey = this._computeStableIdentity(finding);
    for (const [existingId, existingFinding] of engineMap) {
      if (
        existingId !== finding.id &&
        this._computeStableIdentity(existingFinding) === newKey
      ) {
        engineMap.delete(existingId);
        break;
      }
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
      'unused-code': 0,
      'type-safety': 0,
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

