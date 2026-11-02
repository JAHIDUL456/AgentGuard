import * as assert from 'assert';
import * as vscode from 'vscode';
import { AgentGuardEngine } from '../../src/core/engine';
import { NullLogger } from '../../src/core/logger';
import { Finding } from '../../src/core/types';
import { FindingManager } from '../../src/findings/finding-manager';
import { NativeDiagnosticsPublisher } from '../../src/findings/native-diagnostics';
import { LanguageAdapterRegistry } from '../../src/languages/adapter-registry';
import { StatusBarManager } from '../../src/ui/status-bar/status-bar-manager';
import { AgentGuardTreeProvider } from '../../src/ui/tree/agentguard-tree-provider';
import { FindingTreeItem, SectionTreeItem } from '../../src/ui/tree/tree-items';
import { WorkspaceManager } from '../../src/workspace/workspace-manager';

suite('Stage 6: Professional Native VS Code UI & Finding Manager', () => {
  const logger = new NullLogger();

  test('FindingManager: supports creation, updating, removal, and stale cleanup by URI', () => {
    const manager = new FindingManager(logger);

    const f1: Finding = {
      id: 'f-1',
      category: 'confirmed-new-diagnostic',
      severity: 'error',
      confidence: 'high',
      title: 'Type Error',
      message: 'TS2304: Cannot find name x',
      evidence: 'L10:C2',
      explanation: 'Regression',
      location: {
        filePath: 'src/app.ts',
        uri: vscode.Uri.file('/workspace/src/app.ts'),
        range: new vscode.Range(10, 2, 10, 5),
      },
      sourceEngine: 'diagnostic-delta',
      timestamp: Date.now(),
    };

    // 1. Add finding
    manager.addFinding(f1);
    assert.strictEqual(manager.getAll().length, 1);

    // 2. Update finding
    const f1Updated: Finding = {
      ...f1,
      message: 'Updated message',
    };
    manager.updateFinding(f1Updated);
    assert.strictEqual(manager.getAll().length, 1);
    assert.strictEqual(manager.getAll()[0]!.message, 'Updated message');

    // 3. Query by URI
    const byUri = manager.getFindingsForUri(vscode.Uri.file('/workspace/src/app.ts'));
    assert.strictEqual(byUri.length, 1);

    // 4. Stale cleanup by URI
    manager.removeFindingsForUri(vscode.Uri.file('/workspace/src/app.ts'));
    assert.strictEqual(manager.getAll().length, 0);

    manager.dispose();
  });

  test('FindingManager: cross-engine deduplication retains highest severity/confidence', () => {
    const manager = new FindingManager(logger);

    // Engine A reports a warning
    const findingA: Finding = {
      id: 'engineA-auth-1',
      category: 'logic-risk',
      severity: 'warning',
      confidence: 'medium',
      title: 'Potential Logic Risk: Auth Guard Modified',
      message: 'Auth check changed',
      evidence: 'Line 20',
      explanation: 'Explanation A',
      location: {
        filePath: 'src/auth.ts',
        uri: vscode.Uri.file('/workspace/src/auth.ts'),
        range: new vscode.Range(20, 0, 20, 30),
      },
      sourceEngine: 'engine-a',
      timestamp: Date.now(),
      metadata: { watchdogCategory: 'authentication' },
    };

    // Engine B reports the same location with critical error
    const findingB: Finding = {
      id: 'engineB-auth-1',
      category: 'logic-risk',
      severity: 'error',
      confidence: 'high',
      title: 'Potential Security Risk: Authentication Guard Removed',
      message: 'Auth guard stripped',
      evidence: 'Line 20 authMiddleware removed',
      explanation: 'Explanation B',
      location: {
        filePath: 'src/auth.ts',
        uri: vscode.Uri.file('/workspace/src/auth.ts'),
        range: new vscode.Range(20, 0, 20, 30),
      },
      sourceEngine: 'engine-b',
      timestamp: Date.now(),
      metadata: { watchdogCategory: 'authentication' },
    };

    manager.setFindings('engine-a', [findingA]);
    manager.setFindings('engine-b', [findingB]);

    const deduplicated = manager.getAll();
    assert.strictEqual(deduplicated.length, 1, 'Should deduplicate cross-engine findings on same line/topic');
    assert.strictEqual(deduplicated[0]!.severity, 'error', 'Should retain higher severity (error over warning)');
    assert.strictEqual(deduplicated[0]!.confidence, 'high');

    manager.dispose();
  });

  test('FindingManager: multi-root workspace isolation and clearByWorkspace', () => {
    const manager = new FindingManager(logger);

    const rootA = vscode.Uri.file('/projects/repo-a');
    const rootB = vscode.Uri.file('/projects/repo-b');

    const findingA: Finding = {
      id: 'fa-1',
      category: 'potentially-broken-contract',
      severity: 'error',
      confidence: 'high',
      title: 'Broken Contract in Repo A',
      message: 'Repo A issue',
      evidence: 'Line 5',
      explanation: 'Repo A',
      location: {
        filePath: 'src/index.ts',
        uri: vscode.Uri.file('/projects/repo-a/src/index.ts'),
        workspaceRootUri: rootA,
      },
      sourceEngine: 'blast-radius',
      timestamp: Date.now(),
    };

    const findingB: Finding = {
      id: 'fb-1',
      category: 'potentially-broken-contract',
      severity: 'error',
      confidence: 'high',
      title: 'Broken Contract in Repo B',
      message: 'Repo B issue',
      evidence: 'Line 5',
      explanation: 'Repo B',
      location: {
        filePath: 'src/index.ts',
        uri: vscode.Uri.file('/projects/repo-b/src/index.ts'),
        workspaceRootUri: rootB,
      },
      sourceEngine: 'blast-radius',
      timestamp: Date.now(),
    };

    manager.setFindings('engine-1', [findingA, findingB]);
    assert.strictEqual(manager.getAll().length, 2);

    // Clear findings only for repo A
    manager.clearByWorkspace(rootA);

    const remaining = manager.getAll();
    assert.strictEqual(remaining.length, 1);
    assert.strictEqual(remaining[0]!.location.uri.fsPath, '/projects/repo-b/src/index.ts');

    manager.dispose();
  });

  test('NativeDiagnosticsPublisher: publishes diagnostics and clears them when findings resolve', () => {
    const manager = new FindingManager(logger);
    const publisher = new NativeDiagnosticsPublisher(manager, logger);

    const fileUri = vscode.Uri.file('/workspace/src/service.ts');

    const finding: Finding = {
      id: 'diag-1',
      category: 'confirmed-new-diagnostic',
      severity: 'error',
      confidence: 'high',
      title: 'New Compiler Error',
      message: 'TS2304: Cannot find name db',
      evidence: 'Source: ts, Code: TS2304, Line: 15',
      explanation: 'Compiler regression detected',
      location: {
        filePath: 'src/service.ts',
        uri: fileUri,
        range: new vscode.Range(14, 2, 14, 4),
      },
      sourceEngine: 'diagnostic-delta',
      timestamp: Date.now(),
    };

    manager.addFinding(finding);

    // Verify diagnostic was published to VS Code diagnostic collection
    const published = publisher.collection.get(fileUri as any);
    assert.ok(published && published.length === 1);
    assert.strictEqual(published[0]!.message, '[HIGH] New Compiler Error: TS2304: Cannot find name db');
    assert.strictEqual(published[0]!.severity, vscode.DiagnosticSeverity.Error);
    assert.strictEqual(published[0]!.source, 'AgentGuard');

    // Remove the finding (issue resolved)
    manager.removeFinding('diag-1');

    const cleared = publisher.collection.get(fileUri as any);
    assert.ok(!cleared || cleared.length === 0, 'Diagnostic should be removed when finding is resolved');

    publisher.dispose();
    manager.dispose();
  });

  test('FindingTreeItem: provides navigation command with line selection and Markdown tooltip', () => {
    const finding: Finding = {
      id: 'nav-test',
      category: 'logic-risk',
      severity: 'error',
      confidence: 'high',
      title: 'Authentication Middleware Removed',
      message: 'Route /api/profile is now public',
      evidence: 'authMiddleware removed from line 42',
      explanation: 'Exposes private customer data to unauthenticated requests',
      location: {
        filePath: 'src/routes.ts',
        uri: vscode.Uri.file('/workspace/src/routes.ts'),
        range: new vscode.Range(41, 0, 41, 50),
      },
      sourceEngine: 'watchdog',
      timestamp: Date.now(),
    };

    const treeItem = new FindingTreeItem(finding);

    assert.ok(treeItem.command, 'TreeItem must have a navigation command');
    assert.strictEqual(treeItem.command.command, 'vscode.open');
    assert.deepStrictEqual(treeItem.command.arguments?.[0], finding.location.uri);
    assert.deepStrictEqual(
      (treeItem.command.arguments?.[1] as any)?.selection,
      finding.location.range
    );

    assert.ok(treeItem.tooltip instanceof vscode.MarkdownString);
    const mdValue = (treeItem.tooltip as vscode.MarkdownString).value;
    assert.ok(mdValue.includes('Authentication Middleware Removed'));
    assert.ok(mdValue.includes('Exposes private customer data'));
    assert.ok(mdValue.includes('authMiddleware removed from line 42'));
  });

  test('AgentGuardTreeProvider: renders STATUS, LANGUAGES, and RECENT ACTIVITY, and hides empty sections', async () => {
    const rootUri = vscode.Uri.file('/workspace');
    (vscode.workspace as any).workspaceFolders = [
      { uri: rootUri, name: 'Workspace', index: 0 },
    ];
    const workspaceManager = new WorkspaceManager(logger);
    const languageRegistry = new LanguageAdapterRegistry(logger);
    languageRegistry.registerBuiltinAdapters();

    const findingManager = new FindingManager(logger);
    const mockEngine = {
      state: 'ready',
      gitAvailable: true,
      gitRepoCount: 1,
      getStatus: () => ({
        state: 'ready',
        activeWorkspaceFolders: 1,
        findingCount: 0,
        lastScanTimestamp: Date.now(),
        gitAvailable: true,
        gitRepoCount: 1,
      }),
      onDidChangeState: new vscode.EventEmitter<any>().event,
    } as unknown as AgentGuardEngine;

    const provider = new AgentGuardTreeProvider(
      mockEngine,
      workspaceManager,
      findingManager,
      languageRegistry
    );

    // 1. Initial Clean State: 0 findings
    const initialSections = (await provider.getChildren()) as SectionTreeItem[];
    const sectionIds = initialSections.map(s => s.sectionId);

    assert.ok(sectionIds.includes('status'), 'STATUS must be present');
    assert.ok(sectionIds.includes('languages'), 'LANGUAGES must be present');
    assert.ok(sectionIds.includes('recent-activity'), 'RECENT ACTIVITY must be present');
    assert.ok(!sectionIds.includes('critical'), 'CRITICAL must be hidden when 0 findings');
    assert.ok(!sectionIds.includes('warnings'), 'WARNINGS must be hidden when 0 findings');
    assert.ok(!sectionIds.includes('review'), 'REVIEW must be hidden when 0 findings');

    // 2. Add an Error finding: CRITICAL section must appear
    findingManager.addFinding({
      id: 'crit-1',
      category: 'logic-risk',
      severity: 'error',
      confidence: 'high',
      title: 'Auth Guard Removed',
      message: 'Security issue',
      evidence: 'evidence',
      explanation: 'explanation',
      location: {
        filePath: 'src/app.ts',
        uri: vscode.Uri.file('/workspace/src/app.ts'),
      },
      sourceEngine: 'watchdog',
      timestamp: Date.now(),
    });

    const updatedSections = (await provider.getChildren()) as SectionTreeItem[];
    const updatedSectionIds = updatedSections.map(s => s.sectionId);
    assert.ok(updatedSectionIds.includes('critical'), 'CRITICAL must now be visible');
    assert.ok(!updatedSectionIds.includes('warnings'), 'WARNINGS still hidden');

    // 3. Inspect children of CRITICAL section
    const criticalSection = updatedSections.find(s => s.sectionId === 'critical')!;
    const criticalItems = await provider.getChildren(criticalSection);
    assert.strictEqual(criticalItems.length, 1);
    assert.strictEqual((criticalItems[0] as FindingTreeItem).finding.title, 'Auth Guard Removed');

    // 4. Inspect children of LANGUAGES section
    const langSection = updatedSections.find(s => s.sectionId === 'languages')!;
    const langItems = await provider.getChildren(langSection);
    assert.strictEqual(langItems.length, 11, 'Should list all 11 adapters');

    workspaceManager.dispose();
    findingManager.dispose();
  });

  test('StatusBarManager: reflects All Clear, Analyzing, Incomplete, and Issue states accurately', () => {
    const rootUri = vscode.Uri.file('/workspace');
    (vscode.workspace as any).workspaceFolders = [
      { uri: rootUri, name: 'Workspace', index: 0 },
    ];
    const workspaceManager = new WorkspaceManager(logger);
    const findingManager = new FindingManager(logger);

    let engineState = 'ready';
    const onDidChangeEngineState = new vscode.EventEmitter<any>();

    const mockEngine = {
      get state() {
        return engineState;
      },
      gitAvailable: true,
      gitRepoCount: 1,
      onDidChangeState: onDidChangeEngineState.event,
    } as unknown as AgentGuardEngine;

    const statusBar = new StatusBarManager(mockEngine, workspaceManager, findingManager);

    // 1. All Clear state
    assert.ok(statusBar.item.text.includes('All Clear'));
    assert.strictEqual(statusBar.item.backgroundColor, undefined);

    // 2. Analyzing state
    engineState = 'analyzing';
    onDidChangeEngineState.fire('analyzing');
    assert.ok(statusBar.item.text.includes('Analyzing...'));

    // 3. Back to ready with critical error finding
    engineState = 'ready';
    onDidChangeEngineState.fire('ready');
    findingManager.addFinding({
      id: 'e-1',
      category: 'confirmed-new-diagnostic',
      severity: 'error',
      confidence: 'high',
      title: 'Error',
      message: 'msg',
      evidence: 'ev',
      explanation: 'exp',
      location: {
        filePath: 'src/app.ts',
        uri: vscode.Uri.file('/workspace/src/app.ts'),
      },
      sourceEngine: 'engine',
      timestamp: Date.now(),
    });
    assert.ok(statusBar.item.text.includes('1 Issue Detected'));
    assert.ok(statusBar.item.backgroundColor !== undefined);

    // 4. Analysis incomplete category prevents false All Clear
    findingManager.clear();
    findingManager.addFinding({
      id: 'inc-1',
      category: 'analysis-incomplete',
      severity: 'info',
      confidence: 'low',
      title: 'Incomplete',
      message: 'Tooling missing',
      evidence: 'ev',
      explanation: 'exp',
      location: {
        filePath: 'src/app.ts',
        uri: vscode.Uri.file('/workspace/src/app.ts'),
      },
      sourceEngine: 'engine',
      timestamp: Date.now(),
    });
    assert.ok(statusBar.item.text.includes('Analysis Incomplete'));
    assert.ok(!statusBar.item.text.includes('All Clear'), 'Must NEVER claim All Clear when analysis is incomplete');

    statusBar.dispose();
    workspaceManager.dispose();
    findingManager.dispose();
  });

  test('AgentGuardTreeProvider: displays waiting state when no workspace folder is open', async () => {
    (vscode.workspace as any).workspaceFolders = [];
    const workspaceManager = new WorkspaceManager(logger);
    const findingManager = new FindingManager(logger);
    const mockEngine = {
      state: 'ready',
      gitAvailable: false,
      gitRepoCount: 0,
      getStatus: () => ({
        state: 'ready',
        activeWorkspaceFolders: 0,
        findingCount: 0,
        lastScanTimestamp: 0,
        gitAvailable: false,
        gitRepoCount: 0,
      }),
      onDidChangeState: new vscode.EventEmitter<any>().event,
    } as unknown as AgentGuardEngine;

    const provider = new AgentGuardTreeProvider(
      mockEngine,
      workspaceManager,
      findingManager
    );
    const rootItems = await provider.getChildren();
    assert.strictEqual(rootItems.length, 2);
    assert.strictEqual(rootItems[0]?.description, 'Waiting for workspace');

    workspaceManager.dispose();
    findingManager.dispose();
  });
});

