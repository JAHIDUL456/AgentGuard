import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { ILogger } from '../../core/logger';
import { Finding, FindingCategory, FindingSeverity } from '../../core/types';
import { GitService } from '../../git/git-service';
import { LanguageAdapterRegistry } from '../../languages/adapter-registry';
import { isIgnoredPath } from '../../utils/path-utils';
import { WorkspaceManager } from '../../workspace/workspace-manager';
import { AnalysisScope, IAnalysisEngine } from '../types';
import { WatchdogRuleRegistry } from './rules/rule-registry';
import { isTestFilePath } from './test-filter';
import {
  CodeChangeContext,
  CodeLine,
  WatchdogFindingCandidate,
} from './watchdog-types';

export class LogicWatchdogEngine implements IAnalysisEngine {
  public static readonly MAX_FILE_SIZE_BYTES = 2 * 1024 * 1024; // 2MB safety threshold
  public readonly id = 'agentguard.logic-watchdog';
  public readonly name = 'Critical Logic & Safety Watchdog';
  public readonly category: FindingCategory = 'logic-risk';

  private readonly _ruleRegistry: WatchdogRuleRegistry;
  private readonly _previousContentCache = new Map<string, string>();

  constructor(
    private readonly _workspaceManager: WorkspaceManager,
    private readonly _languageRegistry: LanguageAdapterRegistry,
    private readonly _gitService: GitService,
    private readonly _logger: ILogger,
    ruleRegistry?: WatchdogRuleRegistry
  ) {
    this._ruleRegistry = ruleRegistry ?? new WatchdogRuleRegistry();
  }

  public get ruleRegistry(): WatchdogRuleRegistry {
    return this._ruleRegistry;
  }

  /**
   * Seeds the content cache for a file (useful during initialization or testing).
   */
  public seedContentCache(uri: vscode.Uri, content: string): void {
    this._previousContentCache.set(uri.fsPath, content);
  }

  public async analyze(
    scope: AnalysisScope,
    token?: vscode.CancellationToken
  ): Promise<readonly Finding[]> {
    if (token?.isCancellationRequested) {
      return [];
    }

    const changedUris = await this._resolveChangedFiles(scope, token);
    if (changedUris.length === 0 || token?.isCancellationRequested) {
      return [];
    }

    const findings: Finding[] = [];
    const seenFindingKeys = new Set<string>();

    for (const changedUri of changedUris) {
      if (token?.isCancellationRequested) {
        break;
      }

      if (changedUri.scheme !== 'file' || isIgnoredPath(changedUri.fsPath)) {
        continue;
      }

      const root = this._workspaceManager.getRootForUri(changedUri);
      if (!root) {
        continue;
      }

      let newContent: string;
      try {
        const stat = await fs.promises.stat(changedUri.fsPath);
        if (stat.size > LogicWatchdogEngine.MAX_FILE_SIZE_BYTES) {
          this._logger.debug(`Skipping large file > 2MB: ${changedUri.fsPath}`);
          continue;
        }
        newContent = await fs.promises.readFile(changedUri.fsPath, 'utf8');
      } catch {
        continue;
      }

      // Retrieve previous content
      let oldContent = this._previousContentCache.get(changedUri.fsPath);
      if (oldContent === undefined) {
        oldContent = (await this._gitService.getFileAtHead(changedUri, token)) ?? '';
      }

      // Update cache with new content for next analysis cycle
      this._previousContentCache.set(changedUri.fsPath, newContent);

      // Fast path: if content is unchanged, skip AST/rule processing
      if (oldContent === newContent) {
        continue;
      }

      const adapter = this._languageRegistry.getAdapterForUri(changedUri);
      const languageId = adapter ? adapter.id : 'unknown';

      // Compute line-level diff
      const { removedLines, addedLines } = this._computeLineDiff(oldContent, newContent);
      if (removedLines.length === 0 && addedLines.length === 0) {
        continue;
      }

      const relPath = path
        .relative(root.uri.fsPath, changedUri.fsPath)
        .replace(/\\/g, '/');

      const isTestFile = isTestFilePath(changedUri.fsPath);

      const context: CodeChangeContext = {
        uri: changedUri,
        relativeFilePath: relPath,
        isTestFile,
        oldContent,
        newContent,
        removedLines,
        addedLines,
        languageId,
      };

      const candidates = await this._ruleRegistry.inspect(context);

      // Prioritize call sites over pure import statements
      const sortedCandidates = [...candidates].sort((a, b) => {
        const aIsImport = a.evidence.toLowerCase().includes('import ');
        const bIsImport = b.evidence.toLowerCase().includes('import ');
        return (aIsImport ? 1 : 0) - (bIsImport ? 1 : 0);
      });

      for (const candidate of sortedCandidates) {
        const findingKey = `${changedUri.fsPath}:${candidate.ruleId}:${candidate.category}`;
        if (seenFindingKeys.has(findingKey)) {
          continue;
        }
        seenFindingKeys.add(findingKey);

        findings.push(this._createFinding(changedUri, relPath, candidate));
      }
    }

    this._logger.debug(
      `LogicWatchdogEngine evaluated ${changedUris.length} file(s) and produced ${findings.length} finding(s).`
    );

    return findings;
  }

  private _createFinding(
    uri: vscode.Uri,
    relPath: string,
    candidate: WatchdogFindingCandidate
  ): Finding {
    const severity: FindingSeverity =
      candidate.severity === 'critical'
        ? 'error'
        : candidate.severity === 'warning'
        ? 'warning'
        : 'info';

    return {
      id: `watchdog-${candidate.ruleId}-${candidate.category}-${uri.fsPath}-${candidate.line}`,
      category: 'logic-risk',
      severity,
      confidence: candidate.confidence,
      title: candidate.title,
      message: candidate.message,
      evidence: candidate.evidence,
      explanation: candidate.explanation,
      location: {
        filePath: relPath,
        uri,
        range: new vscode.Range(
          candidate.line,
          0,
          candidate.endLine ?? candidate.line,
          80
        ),
      },
      sourceEngine: this.id,
      timestamp: Date.now(),
      metadata: {
        ...candidate.metadata,
        watchdogCategory: candidate.category,
      },
    };
  }

  private _computeLineDiff(
    oldContent: string,
    newContent: string
  ): { removedLines: readonly CodeLine[]; addedLines: readonly CodeLine[] } {
    const oldLines = oldContent ? oldContent.split('\n') : [];
    const newLines = newContent ? newContent.split('\n') : [];

    const newLinesTrimmedSet = new Set(newLines.map(l => l.trim()));
    const oldLinesTrimmedSet = new Set(oldLines.map(l => l.trim()));

    const removedLines: CodeLine[] = [];
    const addedLines: CodeLine[] = [];

    for (let i = 0; i < oldLines.length; i++) {
      const text = oldLines[i] ?? '';
      const trimmed = text.trim();
      if (trimmed.length > 0 && !newLinesTrimmedSet.has(trimmed)) {
        removedLines.push({ line: i, text, trimmed });
      }
    }

    for (let j = 0; j < newLines.length; j++) {
      const text = newLines[j] ?? '';
      const trimmed = text.trim();
      if (trimmed.length > 0 && !oldLinesTrimmedSet.has(trimmed)) {
        addedLines.push({ line: j, text, trimmed });
      }
    }

    return { removedLines, addedLines };
  }

  private async _resolveChangedFiles(
    scope: AnalysisScope,
    token?: vscode.CancellationToken
  ): Promise<vscode.Uri[]> {
    if (scope.targetUris && scope.targetUris.length > 0) {
      return scope.targetUris.filter(
        u => u.scheme === 'file' && !isIgnoredPath(u.fsPath)
      );
    }

    const changed: vscode.Uri[] = [];

    for (const root of scope.workspaceRoots) {
      if (token?.isCancellationRequested) {
        break;
      }
      try {
        const isRepo = await this._gitService.isGitRepository(root.uri);
        if (isRepo) {
          const status = await this._gitService.getStatusForRoot(root.uri, token);
          if (status) {
            for (const f of status.changedFiles) {
              if (f.status !== 'deleted' && !isIgnoredPath(f.uri.fsPath)) {
                changed.push(f.uri);
              }
            }
          }
        }
      } catch (err) {
        this._logger.debug(`Git status check failed for root ${root.name}:`, err);
      }
    }

    return changed;
  }
}
