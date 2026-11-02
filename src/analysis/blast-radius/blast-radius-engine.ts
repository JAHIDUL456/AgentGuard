import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { ILogger } from '../../core/logger';
import { ConfidenceLevel, Finding, FindingCategory, FindingSeverity } from '../../core/types';
import { GitService } from '../../git/git-service';
import { LanguageAdapterRegistry } from '../../languages/adapter-registry';
import { ILanguageAdapter, StructuralNode } from '../../languages/types';
import { DocumentContentReader } from '../../utils/document-content';
import { isIgnoredPath } from '../../utils/path-utils';
import { WorkspaceManager } from '../../workspace/workspace-manager';
import { DiagnosticTracker } from '../diagnostics/diagnostic-tracker';
import { AnalysisScope, IAnalysisEngine } from '../types';
import { DependencyLink, SymbolChange } from './blast-types';
import { DependencyGraph } from './dependency-graph';
import { StructuralDiffer } from './structural-differ';

export class BlastRadiusEngine implements IAnalysisEngine {
  public static readonly MAX_FILE_SIZE_BYTES = 2 * 1024 * 1024; // 2MB safety threshold
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
        currentContent = await DocumentContentReader.readContent(changedUri);
        if (currentContent.length > BlastRadiusEngine.MAX_FILE_SIZE_BYTES) {
          this._logger.debug(`Skipping large file > 2MB: ${changedUri.fsPath}`);
          continue;
        }
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

      // Retrieve previous baseline AST from cache, Git, or disk
      let previousNodes = this._previousAstCache.get(changedUri.fsPath);
      if (!previousNodes) {
        previousNodes = await this._retrievePreviousNodesFromGit(changedUri, adapter);
        if (!previousNodes) {
          try {
            const diskContent = await fs.promises.readFile(changedUri.fsPath, 'utf8');
            const res = await adapter.parseStructure(changedUri, diskContent);
            previousNodes = res.nodes;
          } catch {
            // New untracked file without saved baseline
          }
        }
        if (previousNodes && previousNodes.length > 0) {
          this._previousAstCache.set(changedUri.fsPath, previousNodes);
        }
      }

      // Only advance baseline when saved to disk or during wide scan (NOT during fast-local typing)
      if (scope.level !== 'fast-local') {
        this._previousAstCache.set(changedUri.fsPath, currentNodes);
      }

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

      // Filter untouched dependent links (not part of the current modification batch)
      const untouchedLinks = dependentLinks.filter(
        l => !changedPathSet.has(l.consumerUri.fsPath)
      );

      const changedFileName = path.basename(changedUri.fsPath);

      // 1. Dynamic imports
      for (const link of untouchedLinks) {
        if (link.isDynamic) {
          findings.push({
            id: `blast-dynamic-${link.consumerRelativePath}-${changedFileName}`,
            ruleId: 'blast-radius.dynamic-import',
            category: 'analysis-incomplete',
            severity: 'warning',
            confidence: 'low',
            evidenceClassification: 'needs-review',
            status: 'open',
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
            relatedLocations: [
              {
                filePath: path.basename(changedUri.fsPath),
                uri: changedUri,
              },
            ],
            suggestedRemediation: 'Convert to static import or verify runtime exports.',
            sourceEngine: this.id,
            timestamp: Date.now(),
          });
        }
      }

      // 2. Evaluate symbol changes with root-cause grouping
      for (const change of changes) {
        if (change.changeKind === 'added') {
          continue;
        }

        const matchingLinks = untouchedLinks.filter(
          l =>
            !l.isDynamic &&
            (l.importedSymbols.includes('*') || l.importedSymbols.includes(change.name))
        );

        if (matchingLinks.length === 0) {
          continue;
        }

        if (matchingLinks.length === 1) {
          // Exactly 1 consumer file - emit single finding
          const link = matchingLinks[0]!;
          const singleFindings = this._evaluateDependentImpact(
            changedUri,
            [change],
            link,
            newDiagnosticsOnUntouched
          );
          findings.push(...singleFindings);
        } else {
          // Multiple consumers - group under single genuine root cause
          const groupedFinding = this._evaluateGroupedImpact(
            changedUri,
            change,
            matchingLinks,
            newDiagnosticsOnUntouched
          );
          findings.push(groupedFinding);
        }
      }
    }

    this._logger.debug(
      `BlastRadiusEngine evaluated ${changedUris.length} changed file(s) and produced ${findings.length} finding(s).`
    );

    return findings;
  }

  private _evaluateGroupedImpact(
    changedUri: vscode.Uri,
    change: SymbolChange,
    links: readonly DependencyLink[],
    newDiagnostics: readonly { fileUri: vscode.Uri; message: string; line: number }[]
  ): Finding {
    const changedFileName = path.basename(changedUri.fsPath);
    const uniqueFiles = Array.from(new Set(links.map(l => l.consumerRelativePath)));
    const primaryLink = links[0]!;

    const correlatedDiag = newDiagnostics.find(d =>
      links.some(l => l.consumerUri.fsPath === d.fileUri.fsPath)
    );

    const relatedLocations = [
      {
        filePath: changedFileName,
        uri: changedUri,
      },
      ...links.slice(1).map(l => ({
        filePath: l.consumerRelativePath,
        uri: l.consumerUri,
        range: new vscode.Range(l.line, 0, l.line, 80),
      })),
    ];

    const consumerListStr = links
      .map(l => `'${l.consumerRelativePath}' on line ${l.line + 1}`)
      .join(', ');

    if (change.changeKind === 'deleted') {
      return {
        id: `blast-root-${changedFileName}-deleted-${change.name}`,
        ruleId: 'blast-radius.deleted-symbol',
        category: 'potentially-broken-contract',
        severity: 'error',
        confidence: 'high',
        evidenceClassification: correlatedDiag ? 'confirmed-regression' : 'structural-regression',
        status: 'open',
        verificationState: 'verified-breaking',
        title: `Broken Contract: Removed Export '${change.name}' (${links.length} references across ${uniqueFiles.length} files affected)`,
        message: `Export '${change.name}' was removed from '${changedFileName}'. ${links.length} references across ${uniqueFiles.length} untouched file(s) still import it.`,
        evidence: `Exported symbol '${change.name}' deleted in provider '${changedFileName}'. Untouched consumers: ${consumerListStr}.`,
        explanation:
          'Removing an exported symbol without updating downstream consuming files breaks the interface contract across multiple untouched files in the project.',
        location: {
          filePath: primaryLink.consumerRelativePath,
          uri: primaryLink.consumerUri,
          range: new vscode.Range(primaryLink.line, 0, primaryLink.line, 80),
        },
        relatedLocations,
        suggestedRemediation: `Restore export '${change.name}' in '${changedFileName}' or update consumers: ${uniqueFiles.join(', ')}.`,
        sourceEngine: this.id,
        timestamp: Date.now(),
      };
    } else if (change.changeKind === 'signature-changed') {
      return {
        id: `blast-root-${changedFileName}-sig-${change.name}`,
        ruleId: 'blast-radius.signature-changed',
        category: 'potentially-broken-contract',
        severity: correlatedDiag ? 'error' : 'warning',
        confidence: 'high',
        evidenceClassification: 'structural-regression',
        status: 'open',
        verificationState: correlatedDiag ? 'verified-breaking' : 'unverified',
        title: `Contract Mismatch: '${change.name}' Signature Changed (${links.length} callers across ${uniqueFiles.length} files affected)`,
        message: `The signature of '${change.name}' changed in '${changedFileName}'. ${links.length} untouched call sites across ${uniqueFiles.length} files may be passing incompatible arguments.`,
        evidence: `${change.details ?? 'Signature altered'}. Untouched callers: ${consumerListStr}.`,
        explanation:
          'Changing function parameters or shapes without updating untouched callers introduces logic regressions or type mismatches across dependent files.',
        location: {
          filePath: primaryLink.consumerRelativePath,
          uri: primaryLink.consumerUri,
          range: new vscode.Range(primaryLink.line, 0, primaryLink.line, 80),
        },
        relatedLocations,
        suggestedRemediation: `Update call sites in ${uniqueFiles.join(', ')} to match new '${change.name}' signature.`,
        sourceEngine: this.id,
        timestamp: Date.now(),
      };
    } else {
      return {
        id: `blast-root-${changedFileName}-renamed-${change.name}`,
        ruleId: 'blast-radius.renamed-symbol',
        category: 'unresolved-reference',
        severity: 'error',
        confidence: 'high',
        evidenceClassification: 'structural-regression',
        status: 'open',
        verificationState: 'verified-breaking',
        title: `Unresolved Reference: Symbol '${change.name}' Renamed (${links.length} imports across ${uniqueFiles.length} files affected)`,
        message: `Symbol '${change.name}' was renamed in '${changedFileName}'. ${links.length} imports in ${uniqueFiles.length} untouched files still reference the old name.`,
        evidence: `${change.details ?? 'Renamed'}. Untouched references: ${consumerListStr}.`,
        explanation:
          'Renaming a symbol in a provider without refactoring consumer imports leaves untouched call sites pointing to non-existent exports.',
        location: {
          filePath: primaryLink.consumerRelativePath,
          uri: primaryLink.consumerUri,
          range: new vscode.Range(primaryLink.line, 0, primaryLink.line, 80),
        },
        relatedLocations,
        suggestedRemediation: `Update imports in ${uniqueFiles.join(', ')} to reference the renamed symbol.`,
        sourceEngine: this.id,
        timestamp: Date.now(),
      };
    }
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
        ruleId: 'blast-radius.dynamic-import',
        category: 'analysis-incomplete',
        severity: 'warning',
        confidence: 'low',
        evidenceClassification: 'needs-review',
        status: 'open',
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
        relatedLocations: [
          {
            filePath: path.basename(changedUri.fsPath),
            uri: changedUri,
          },
        ],
        suggestedRemediation: 'Convert to static import or verify runtime exports.',
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
          ruleId: 'blast-radius.deleted-symbol',
          category: 'potentially-broken-contract',
          severity: 'error',
          confidence,
          evidenceClassification: correlatedDiagnostic ? 'confirmed-regression' : 'structural-regression',
          status: 'open',
          verificationState: 'verified-breaking',
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
          relatedLocations: [
            {
              filePath: path.basename(changedUri.fsPath),
              uri: changedUri,
            },
          ],
          suggestedRemediation: `Restore export '${change.name}' in '${changedFileName}' or update consumer '${link.consumerRelativePath}'.`,
          sourceEngine: this.id,
          timestamp: Date.now(),
        });
      } else if (change.changeKind === 'signature-changed') {
        const severity: FindingSeverity = correlatedDiagnostic ? 'error' : 'warning';
        const confidence: ConfidenceLevel = 'high';

        findings.push({
          id: `blast-sig-${link.consumerRelativePath}-${change.name}`,
          ruleId: 'blast-radius.signature-changed',
          category: 'potentially-broken-contract',
          severity,
          confidence,
          evidenceClassification: 'structural-regression',
          status: 'open',
          verificationState: correlatedDiagnostic ? 'verified-breaking' : 'unverified',
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
          relatedLocations: [
            {
              filePath: path.basename(changedUri.fsPath),
              uri: changedUri,
            },
          ],
          suggestedRemediation: `Update call sites in '${link.consumerRelativePath}' to match new '${change.name}' signature.`,
          sourceEngine: this.id,
          timestamp: Date.now(),
        });
      } else if (change.changeKind === 'renamed') {
        findings.push({
          id: `blast-renamed-${link.consumerRelativePath}-${change.name}`,
          ruleId: 'blast-radius.renamed-symbol',
          category: 'unresolved-reference',
          severity: 'error',
          confidence: 'high',
          evidenceClassification: 'structural-regression',
          status: 'open',
          verificationState: 'verified-breaking',
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
          relatedLocations: [
            {
              filePath: path.basename(changedUri.fsPath),
              uri: changedUri,
            },
          ],
          suggestedRemediation: `Update import and call sites in '${link.consumerRelativePath}' to reference the renamed symbol.`,
          sourceEngine: this.id,
          timestamp: Date.now(),
        });
      }
    }

    // If interface changed in provider but no specific named export matched (e.g. general dependency impact)
    if (findings.length === 0 && changes.some(c => c.changeKind !== 'added')) {
      findings.push({
        id: `blast-affected-${link.consumerRelativePath}-${changedFileName}`,
        ruleId: 'blast-radius.dependent-review',
        category: 'potentially-affected-dependency',
        severity: 'info',
        confidence: 'medium',
        evidenceClassification: 'needs-review',
        status: 'open',
        verificationState: 'unverified',
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
        relatedLocations: [
          {
            filePath: path.basename(changedUri.fsPath),
            uri: changedUri,
          },
        ],
        suggestedRemediation: `Review '${link.consumerRelativePath}' to verify compatibility with changes in '${changedFileName}'.`,
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
    adapter: ILanguageAdapter
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
