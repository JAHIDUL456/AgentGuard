import * as assert from 'assert';
import * as vscode from 'vscode';
import { AnalysisEngineRegistry } from '../../src/analysis/analyzer-registry';
import { AgentGuardEngine } from '../../src/core/engine';
import { NullLogger } from '../../src/core/logger';
import { FindingManager } from '../../src/findings/finding-manager';
import { GitService } from '../../src/git/git-service';
import { LanguageAdapterRegistry } from '../../src/languages/adapter-registry';
import { ChangeMonitor } from '../../src/monitoring/change-monitor';
import { StatusBarManager } from '../../src/ui/status-bar/status-bar-manager';
import { AgentGuardTreeProvider } from '../../src/ui/tree/agentguard-tree-provider';
import { WorkspaceManager } from '../../src/workspace/workspace-manager';

suite('Status Bar & Tree Provider UI', () => {
  let engine: AgentGuardEngine;
  let workspaceManager: WorkspaceManager;
  let changeMonitor: ChangeMonitor;
  let findingManager: FindingManager;
  let languageRegistry: LanguageAdapterRegistry;
  let analysisRegistry: AnalysisEngineRegistry;
  let gitService: GitService;
  let logger: NullLogger;
  let treeProvider: AgentGuardTreeProvider;
  let statusBar: StatusBarManager;

  setup(async () => {
    logger = new NullLogger();
    (vscode.workspace as any).workspaceFolders = [];
    workspaceManager = new WorkspaceManager(logger);
    changeMonitor = new ChangeMonitor(logger);
    findingManager = new FindingManager(logger);
    languageRegistry = new LanguageAdapterRegistry(logger);
    analysisRegistry = new AnalysisEngineRegistry(logger);
    gitService = new GitService(logger);

    engine = new AgentGuardEngine(
      workspaceManager,
      changeMonitor,
      findingManager,
      languageRegistry,
      analysisRegistry,
      gitService,
      logger
    );

    treeProvider = new AgentGuardTreeProvider(
      engine,
      workspaceManager,
      findingManager
    );
    statusBar = new StatusBarManager(
      engine,
      workspaceManager,
      findingManager
    );

    await engine.initialize();
  });

  teardown(() => {
    statusBar.dispose();
    engine.dispose();
    gitService.dispose();
    analysisRegistry.dispose();
    languageRegistry.dispose();
    findingManager.dispose();
    changeMonitor.dispose();
    workspaceManager.dispose();
    (vscode.workspace as any).workspaceFolders = [];
  });

  test('tree provider shows "Waiting for workspace" when no folder is open', async () => {
    const rootItems = await treeProvider.getChildren();
    assert.strictEqual(rootItems.length, 2);
    assert.strictEqual(rootItems[0]?.description, 'Waiting for workspace');
    assert.ok(statusBar.item.text.includes('Waiting'));
  });

  test('tree provider updates to "Ready" when workspace folder is attached', async () => {
    (vscode.workspace as any).workspaceFolders = [
      {
        uri: vscode.Uri.file('/my-project'),
        name: 'my-project',
        index: 0,
      },
    ];
    (vscode.workspace as any)._fireDidChangeWorkspaceFolders({
      added: (vscode.workspace as any).workspaceFolders,
      removed: [],
    });

    const rootItems = await treeProvider.getChildren();
    assert.ok(rootItems.length >= 3);
    const firstDesc = String(rootItems[0]?.description ?? '');
    assert.ok(firstDesc.includes('Ready'));
    assert.ok(rootItems.some(item => item.label === 'Git Status' || item.label === 'Git Integration'));
    assert.ok(rootItems.some(item => item.label === 'No Risks Detected'));
    assert.ok(statusBar.item.text.includes('Ready'));
  });
});
