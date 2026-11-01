import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { ILogger } from '../../core/logger';
import { ConfidenceLevel, Finding, FindingCategory, FindingSeverity } from '../../core/types';
import { GitService } from '../../git/git-service';
import { LanguageAdapterRegistry } from '../../languages/adapter-registry';
import { StructuralNode } from '../../languages/types';
import { isIgnoredPath } from '../../utils/path-utils';
import { WorkspaceManager } from '../../workspace/workspace-manager';
import { DiagnosticTracker } from '../diagnostics/diagnostic-tracker';
import { AnalysisScope, IAnalysisEngine } from '../types';
import { DependencyLink, SymbolChange } from './blast-types';
import { DependencyGraph } from './dependency-graph';
import { StructuralDiffer } from './structural-differ';

export class BlastRadiusEngine implements IAnalysisEngine {
  public readonly id = 'agentguard.blast-radius';
  public readonly name = 'Blast Radius Analysis Engine';
  public readonly category: FindingCategory = 'potentially-affected-dependency';

  private readonly _differ = new StructuralDiffer();
  private readonly _dependencyGraph: DependencyGraph;
  private readonly _previousAstCache = new Map<string, readonly StructuralNode[]>();

  constructor(
    private readonly _workspaceManager: WorkspaceManager,
    private readonly _languageRegistry: LanguageAdapterRegistry,
    private readonly _diagnosticTracker: DiagnosticTracker,
    private readonly _gitService: GitService,
    private readonly _logger: ILogger,
    dependencyGraph?: DependencyGraph
  ) {
    this._dependencyGraph =
      dependencyGraph ??
      new DependencyGraph(this._workspaceManager, this._languageRegistry, this._logger);
  }

  public get dependencyGraph(): DependencyGraph {
    return this._dependencyGraph;
  }

  /**
   * Seeds the AST cache for a file (useful during initialization or testing).
   */
  public seedAstCache(fileUri: vscode.Uri, nodes: readonly StructuralNode[]): void {
    this._previousAstCache.set(fileUri.fsPath, nodes);
  }

  public async analyze(
    scope: AnalysisScope,
    token?: vscode.CancellationToken
  ): Promise<readonly Finding[]> {
    if (token?.isCancellationRequested) {
      return [];
    }

    // 1. Identify changed/modified files
    const changedUris = await this._resolveChangedFiles(scope, token);
    if (changedUris.length === 0 || token?.isCancellationRequested) {
      return [];
    }

    const findings: Finding[] = [];
    const changedPathSet = new Set(changedUris.map(u => u.fsPath));

    // Gather candidate workspace files to search for dependents
    const workspaceFiles = await this._collectWorkspaceFiles(scope, token);

    for (const changedUri of changedUris) {
      if (token?.isCancellationRequested) {
        break;
      }

      const adapter = this._languageRegistry.getAdapterForUri(changedUri);
      if (!adapter) {
        continue;
      }

      let currentContent: string;
      try {
        currentContent = await fs.promises.readFile(changedUri.fsPath, 'utf8');
      } catch {
        continue;
      }

      // Parse current AST
      let currentNodes: readonly StructuralNode[] = [];
      try {
        const result = await adapter.parseStructure(changedUri, currentContent);
        currentNodes = result.nodes;
      } catch (err) {
        this._logger.debug(`Could not parse structure of ${changedUri.fsPath}:`, err);
        continue;
      }

      // Retrieve previous AST from cache or Git
      let previousNodes = this._previousAstCache.get(changedUri.fsPath);
      if (!previousNodes) {
        previousNodes = await this._retrievePreviousNodesFromGit(changedUri, adapter);
      }

      // Always update cache with currentNodes for the next cycle
      this._previousAstCache.set(changedUri.fsPath, currentNodes);

      if (!previousNodes || previousNodes.length === 0) {
        // First observation of this file, no prior structural baseline to diff against
        continue;
      }

      // Diff previous vs current nodes
      const changes = this._differ.diffNodes(previousNodes, currentNodes);
      if (changes.length === 0) {
        continue;
      }

      // Find untouched dependent files that import or link to this changed file
      const dependentLinks = await this._dependencyGraph.findDependents(
        changedUri,
        workspaceFiles
      );

      // Check current diagnostic delta to correlate with newly broken compiler errors on untouched files
      let newDiagnosticsOnUntouched: readonly { fileUri: vscode.Uri; message: string; line: number }[] = [];
      if (this._diagnosticTracker.isBaselineReady) {
        const delta = await this._diagnosticTracker.computeDelta(
          dependentLinks.map(l => l.consumerUri),
          token
        );
        newDiagnosticsOnUntouched = delta.newDiagnostics.map(d => ({
          fileUri: d.fileUri,
          message: d.message,
          line: d.line,
        }));
      }

      for (const link of dependentLinks) {
        // Must be an untouched file (not part of the current modification batch)
        if (changedPathSet.has(link.consumerUri.fsPath)) {
          continue;
        }

        const linkFindings = this._evaluateDependentImpact(
          changedUri,
          changes,
          link,
          newDiagnosticsOnUntouched
        );
        findings.push(...linkFindings);
      }
    }

    this._logger.debug(
      `BlastRadiusEngine evaluated ${changedUris.length} changed file(s) and produced ${findings.length} finding(s).`
    );

    return findings;
  }

  private _evaluateDependentImpact(
    changedUri: vscode.Uri,
    changes: readonly SymbolChange[],
    link: DependencyLink,
    newDiagnostics: readonly { fileUri: vscode.Uri; message: string; line: number }[]
  ): Finding[] {
    const findings: Finding[] = [];
    const changedFileName = path.basename(changedUri.fsPath);

    // Look for correlated new diagnostic on the consumer file
    const correlatedDiagnostic = newDiagnostics.find(
      d => d.fileUri.fsPath === link.consumerUri.fsPath
    );

    // Dynamic import handling
    if (link.isDynamic) {
      findings.push({
        id: `blast-dynamic-${link.consumerRelativePath}-${changedFileName}`,
        category: 'analysis-incomplete',
        severity: 'warning',
        confidence: 'low',
        title: `Dynamic Dependency on Modified File: ${changedFileName}`,
        message: `Untouched file '${link.consumerRelativePath}' dynamically imports '${link.rawImport}' which changed.`,
        evidence: `Dynamic import: '${link.rawImport}' on line ${link.line + 1}.`,
        explanation:
          'Dynamic module imports cannot be statically verified. Any removed or modified exports in the target file may cause runtime errors.',
        location: {
          filePath: link.consumerRelativePath,
          uri: link.consumerUri,
          range: new vscode.Range(link.line, 0, link.line, 80),
        },
        sourceEngine: this.id,
        timestamp: Date.now(),
      });
      return findings;
    }

    for (const change of changes) {
      const isImported =
        link.importedSymbols.includes('*') ||
        link.importedSymbols.includes(change.name);

      if (!isImported) {
        continue;
      }

      if (change.changeKind === 'deleted') {
        const confidence: ConfidenceLevel = correlatedDiagnostic ? 'high' : 'high';
        const diagEvidence = correlatedDiagnostic
          ? ` Correlated Compiler Error: "${correlatedDiagnostic.message}".`
          : '';

        findings.push({
          id: `blast-deleted-${link.consumerRelativePath}-${change.name}`,
          category: 'potentially-broken-contract',
          severity: 'error',
          confidence,
          title: `Broken Contract: Removed Symbol '${change.name}' Used in Untouched File`,
          message: `Symbol '${change.name}' was removed from '${changedFileName}', but untouched file '${link.consumerRelativePath}' still imports it.`,
          evidence: `Exported symbol '${change.name}' deleted in provider '${changedFileName}'. Consumer '${link.consumerRelativePath}' imports it on line ${link.line + 1}.${diagEvidence}`,
          explanation:
            'Removing a declared symbol without updating downstream consuming files breaks the interface contract and introduces build or runtime failures.',
          location: {
            filePath: link.consumerRelativePath,
            uri: link.consumerUri,
            range: new vscode.Range(link.line, 0, link.line, 80),
          },
          sourceEngine: this.id,
          timestamp: Date.now(),
        });
      } else if (change.changeKind === 'signature-changed') {
        const severity: FindingSeverity = correlatedDiagnostic ? 'error' : 'warning';
        const confidence: ConfidenceLevel = 'high';

        findings.push({
          id: `blast-sig-${link.consumerRelativePath}-${change.name}`,
          category: 'potentially-broken-contract',
          severity,
          confidence,
          title: `Contract Mismatch: '${change.name}' Signature Changed`,
          message: `The signature of '${change.name}' changed in '${changedFileName}'. Untouched caller '${link.consumerRelativePath}' may be passing incompatible arguments.`,
          evidence: `${change.details ?? 'Signature altered'}. Consumer imports '${change.name}' on line ${link.line + 1}.`,
          explanation:
            'Changing function parameters, return types, or contract shapes without updating untouched callers leads to logic regressions or type errors.',
          location: {
            filePath: link.consumerRelativePath,
            uri: link.consumerUri,
            range: new vscode.Range(link.line, 0, link.line, 80),
          },
          sourceEngine: this.id,
          timestamp: Date.now(),
        });
      } else if (change.changeKind === 'renamed') {
        findings.push({
          id: `blast-renamed-${link.consumerRelativePath}-${change.name}`,
          category: 'unresolved-reference',
          severity: 'error',
          confidence: 'high',
          title: `Unresolved Reference: Symbol '${change.name}' Renamed in Provider`,
          message: `Symbol '${change.name}' was renamed in '${changedFileName}', leaving an unresolved reference in untouched file '${link.consumerRelativePath}'.`,
          evidence: `${change.details ?? 'Renamed'}. Untouched file references old name on line ${link.line + 1}.`,
          explanation:
            'Renaming a symbol in a provider without refactoring consumer imports leaves untouched call sites pointing to non-existent exports.',
          location: {
            filePath: link.consumerRelativePath,
            uri: link.consumerUri,
            range: new vscode.Range(link.line, 0, link.line, 80),
          },
          sourceEngine: this.id,
          timestamp: Date.now(),
        });
      }
    }

    // If interface changed in provider but no specific named export matched (e.g. general dependency impact)
    if (findings.length === 0 && changes.some(c => c.changeKind !== 'added')) {
      findings.push({
        id: `blast-affected-${link.consumerRelativePath}-${changedFileName}`,
        category: 'potentially-affected-dependency',
        severity: 'info',
        confidence: 'medium',
        title: `Potentially Affected Untouched File: ${path.basename(link.consumerRelativePath)}`,
        message: `Untouched file depends on '${changedFileName}' which underwent structural changes.`,
        evidence: `Direct dependency link: imports '${link.rawImport}' on line ${link.line + 1}.`,
        explanation:
          'When a core module changes, dependent untouched files should be reviewed to verify compatibility.',
        location: {
          filePath: link.consumerRelativePath,
          uri: link.consumerUri,
          range: new vscode.Range(link.line, 0, link.line, 80),
        },
        sourceEngine: this.id,
        timestamp: Date.now(),
      });
    }

    return findings;
  }

  private async _resolveChangedFiles(
    scope: AnalysisScope,
    token?: vscode.CancellationToken
  ): Promise<vscode.Uri[]> {
    if (scope.targetUris && scope.targetUris.length > 0) {
      return scope.targetUris.filter(u => u.scheme === 'file' && !isIgnoredPath(u.fsPath));
    }

    const changed: vscode.Uri[] = [];

    // Query Git status if available
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
        this._logger.debug(`Git status query failed for root ${root.name}:`, err);
      }
    }

    return changed;
  }

  private async _collectWorkspaceFiles(
    scope: AnalysisScope,
    token?: vscode.CancellationToken
  ): Promise<readonly vscode.Uri[]> {
    const files: vscode.Uri[] = [];
    for (const root of scope.workspaceRoots) {
      if (token?.isCancellationRequested) {
        break;
      }
      try {
        const pattern = new vscode.RelativePattern(root.uri, '**/*');
        const found = await vscode.workspace.findFiles(
          pattern,
          '**/{node_modules,.git,dist,build,out,vendor,.cache,target,bin,obj}/**',
          1000,
          token
        );
        files.push(...found);
      } catch (err) {
        this._logger.debug(`Failed to collect files for root ${root.name}:`, err);
      }
    }
    return files;
  }

  private async _retrievePreviousNodesFromGit(
    uri: vscode.Uri,
    adapter: any
  ): Promise<readonly StructuralNode[] | undefined> {
    try {
      const root = this._workspaceManager.getRootForUri(uri);
      if (!root) {
        return undefined;
      }
      const gitContent = await this._gitService.getFileAtHead(uri);
      if (gitContent) {
        const result = await adapter.parseStructure(uri, gitContent);
        return result.nodes;
      }
    } catch {
      // File may be newly created/untracked or git unavailable
    }
    return undefined;
  }
}
