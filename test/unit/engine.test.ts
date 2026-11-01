import * as assert from 'assert';
import * as vscode from 'vscode';
import { AnalysisEngineRegistry } from '../../src/analysis/analyzer-registry';
import { AgentGuardEngine } from '../../src/core/engine';
import { NullLogger } from '../../src/core/logger';
import { Finding } from '../../src/core/types';
import { FindingManager } from '../../src/findings/finding-manager';
import { GitService } from '../../src/git/git-service';
import { LanguageAdapterRegistry } from '../../src/languages/adapter-registry';
import { ChangeMonitor } from '../../src/monitoring/change-monitor';
import { WorkspaceManager } from '../../src/workspace/workspace-manager';

suite('AgentGuardEngine', () => {
  let engine: AgentGuardEngine;
  let workspaceManager: WorkspaceManager;
  let changeMonitor: ChangeMonitor;
  let findingManager: FindingManager;
  let languageRegistry: LanguageAdapterRegistry;
  let analysisRegistry: AnalysisEngineRegistry;
  let gitService: GitService;
  let logger: NullLogger;

  setup(() => {
    logger = new NullLogger();
    (vscode.workspace as any).workspaceFolders = [
      {
        uri: vscode.Uri.file('/projects/agentguard-repo'),
        name: 'agentguard-repo',
        index: 0,
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

  test('progresses from uninitialized to ready upon initialize()', async () => {
    assert.strictEqual(engine.state, 'uninitialized');
    await engine.initialize();
    assert.strictEqual(engine.state, 'ready');

    const status = engine.getStatus();
    assert.strictEqual(status.state, 'ready');
    assert.strictEqual(status.activeWorkspaceFolders, 1);
    assert.strictEqual(status.findingCount, 0);
  });

  test('executes registered analysis engines during scanWorkspace()', async () => {
    await engine.initialize();

    const sampleFinding: Finding = {
      id: 'rule-1',
      category: 'logic-risk',
      severity: 'error',
      title: 'Auth guard removed',
      message: 'Authentication middleware was stripped.',
      location: {
        filePath: '/projects/agentguard-repo/src/routes.ts',
        uri: vscode.Uri.file('/projects/agentguard-repo/src/routes.ts'),
      },
      sourceEngine: 'sample-engine',
      timestamp: Date.now(),
    };

    analysisRegistry.registerEngine({
      id: 'sample-engine',
      name: 'Sample Engine',
      category: 'logic-risk',
      analyze: async () => [sampleFinding],
    });

    const findings = await engine.scanWorkspace();
    assert.strictEqual(findings.length, 1);
    assert.strictEqual(findings[0]?.id, 'rule-1');
    assert.strictEqual(engine.getStatus().findingCount, 1);
  });

  test('marks state as disposed upon disposal', () => {
    engine.dispose();
    assert.strictEqual(engine.state, 'disposed');
  });
});

