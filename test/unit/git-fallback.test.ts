import * as assert from 'assert';
import * as vscode from 'vscode';
import { AnalysisEngineRegistry } from '../../src/analysis/analyzer-registry';
import { AgentGuardEngine } from '../../src/core/engine';
import { NullLogger } from '../../src/core/logger';
import { FindingManager } from '../../src/findings/finding-manager';
import { GitService } from '../../src/git/git-service';
import { LanguageAdapterRegistry } from '../../src/languages/adapter-registry';
import { ChangeMonitor } from '../../src/monitoring/change-monitor';
import { WorkspaceManager } from '../../src/workspace/workspace-manager';

suite('Git Fallback & Multi-Root Support', () => {
  let engine: AgentGuardEngine;
  let workspaceManager: WorkspaceManager;
  let changeMonitor: ChangeMonitor;
  let findingManager: FindingManager;
  let languageRegistry: LanguageAdapterRegistry;
  let analysisRegistry: AnalysisEngineRegistry;
  let gitService: GitService;
  let logger: NullLogger;

  setup(async () => {
    logger = new NullLogger();

    // Two roots: one simulating a non-git directory, one simulating git
    (vscode.workspace as any).workspaceFolders = [
      {
        uri: vscode.Uri.file('/workspaces/non-git-project'),
        name: 'non-git-project',
        index: 0,
      },
      {
        uri: vscode.Uri.file('/workspaces/git-project'),
        name: 'git-project',
        index: 1,
      },
    ];

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

    await engine.initialize();
  });

  teardown(() => {
    engine.dispose();
    gitService.dispose();
    analysisRegistry.dispose();
    languageRegistry.dispose();
    findingManager.dispose();
    changeMonitor.dispose();
    workspaceManager.dispose();
    (vscode.workspace as any).workspaceFolders = [];
  });

  test('engine functions seamlessly in fallback mode without git errors', async () => {
    assert.strictEqual(engine.state, 'ready');

    const status = engine.getStatus();
    assert.strictEqual(status.activeWorkspaceFolders, 2);
    assert.strictEqual(status.state, 'ready');

    // Executing scan works in fallback mode
    const findings = await engine.scanWorkspace();
    assert.strictEqual(findings.length, 0);
  });

  test('change monitor continues queuing and debouncing file events without git', done => {
    changeMonitor.onDidBatchReady(batch => {
      assert.strictEqual(batch.events.length, 1);
      assert.strictEqual(batch.events[0]?.uri.fsPath, '/workspaces/non-git-project/src/index.ts');
      done();
    });

    (vscode.workspace as any)._fireDidSaveTextDocument({
      uri: vscode.Uri.file('/workspaces/non-git-project/src/index.ts'),
    });
  });
});
