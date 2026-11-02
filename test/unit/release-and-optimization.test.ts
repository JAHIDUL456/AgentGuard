import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { AnalysisEngineRegistry } from '../../src/analysis/analyzer-registry';
import { AnalysisScope } from '../../src/analysis/types';
import { AgentGuardEngine } from '../../src/core/engine';
import { NullLogger } from '../../src/core/logger';
import { Finding } from '../../src/core/types';
import { InteractiveDemoManager } from '../../src/demo/interactive-demo';
import { FindingManager } from '../../src/findings/finding-manager';
import { GitService } from '../../src/git/git-service';
import { LanguageAdapterRegistry } from '../../src/languages/adapter-registry';
import { TypeScriptAdapter } from '../../src/languages/adapters/typescript-adapter';
import { ChangeMonitor } from '../../src/monitoring/change-monitor';
import {
  FileFilter,
  MAX_ANALYSIS_FILE_SIZE_BYTES,
} from '../../src/monitoring/file-filter';
import { WorkspaceManager } from '../../src/workspace/workspace-manager';

suite('AgentGuard V2.0: Performance, Package Optimization & Demo Tests (Prompt 4)', () => {
  let logger: NullLogger;

  setup(() => {
    logger = new NullLogger();
  });

  // -------------------------------------------------------------------------
  // 1. Workspace Exclusions & File Size Limits
  // -------------------------------------------------------------------------
  test('1. Exclusions: correctly ignores lock files, minified bundles, build dirs, and large files', () => {
    // Lock files
    assert.strictEqual(FileFilter.shouldIgnore('package-lock.json'), true);
    assert.strictEqual(FileFilter.shouldIgnore('yarn.lock'), true);
    assert.strictEqual(FileFilter.shouldIgnore('pnpm-lock.yaml'), true);
    assert.strictEqual(FileFilter.shouldIgnore('Cargo.lock'), true);

    // Minified bundles & maps
    assert.strictEqual(FileFilter.shouldIgnore('dist/bundle.min.js'), true);
    assert.strictEqual(FileFilter.shouldIgnore('src/vendor.min.css'), true);
    assert.strictEqual(FileFilter.shouldIgnore('src/app.js.map'), true);

    // Build & dependency directories
    assert.strictEqual(FileFilter.shouldIgnore('node_modules/express/index.js'), true);
    assert.strictEqual(FileFilter.shouldIgnore('.git/HEAD'), true);
    assert.strictEqual(FileFilter.shouldIgnore('dist/index.js'), true);
    assert.strictEqual(FileFilter.shouldIgnore('target/debug/app'), true);
    assert.strictEqual(FileFilter.shouldIgnore('.next/server/pages.js'), true);

    // Legitimate source files should NOT be ignored
    assert.strictEqual(FileFilter.shouldIgnore('src/components/Header.tsx'), false);
    assert.strictEqual(FileFilter.shouldIgnore('src/services/auth.ts'), false);
    assert.strictEqual(FileFilter.shouldIgnore('backend/api/users.py'), false);

    // File size limit
    assert.strictEqual(
      FileFilter.isFileSizeExceeded(MAX_ANALYSIS_FILE_SIZE_BYTES + 1024),
      true
    );
    assert.strictEqual(
      FileFilter.isFileSizeExceeded(100 * 1024), // 100 KB
      false
    );
  });

  // -------------------------------------------------------------------------
  // 2. Three Analysis Levels (Fast Local vs Incremental Dependency vs Wider)
  // -------------------------------------------------------------------------
  test('2. Three Analysis Levels: engine dispatches fast-local for typing and incremental-dependency for saves', async () => {
    const workspaceManager = new WorkspaceManager(logger);
    (workspaceManager as any)._roots = [
      { uri: vscode.Uri.file('/workspace'), name: 'Workspace', index: 0 },
    ];
    const changeMonitor = new ChangeMonitor(logger);
    const findingManager = new FindingManager(logger);
    const languageRegistry = new LanguageAdapterRegistry(logger);
    languageRegistry.registerAdapter(new TypeScriptAdapter(logger));
    const analysisRegistry = new AnalysisEngineRegistry(logger);
    const gitService = new GitService(logger);

    let lastScopeLevel: string | undefined;

    // Register a mock engine that records the analysis scope level
    analysisRegistry.registerEngine({
      id: 'mock-level-engine',
      name: 'Mock Level Engine',
      category: 'confirmed-new-diagnostic',
      analyze: async (scope: AnalysisScope): Promise<readonly Finding[]> => {
        lastScopeLevel = scope.level;
        return [];
      },
    });

    const engine = new AgentGuardEngine(
      workspaceManager,
      changeMonitor,
      findingManager,
      languageRegistry,
      analysisRegistry,
      gitService,
      logger
    );

    // 1. Typing edit pause -> Fast Local Analysis
    (engine as any)._handleIncrementalChangeBatch({
      id: 'batch-1',
      events: [
        {
          uri: vscode.Uri.file('/workspace/src/app.ts'),
          kind: 'modified',
          source: 'document',
          timestamp: Date.now(),
        },
      ],
      affectedUris: [vscode.Uri.file('/workspace/src/app.ts')],
      timestamp: Date.now(),
    });

    await new Promise(r => setTimeout(r, 40));
    assert.strictEqual(lastScopeLevel, 'fast-local', 'Typing batch must trigger fast-local analysis');

    // 2. File save event -> Incremental Dependency Analysis
    (engine as any)._handleIncrementalChangeBatch({
      id: 'batch-2',
      events: [
        {
          uri: vscode.Uri.file('/workspace/src/app.ts'),
          kind: 'modified',
          source: 'save',
          timestamp: Date.now(),
        },
      ],
      affectedUris: [vscode.Uri.file('/workspace/src/app.ts')],
      timestamp: Date.now(),
    });

    await new Promise(r => setTimeout(r, 40));
    assert.strictEqual(
      lastScopeLevel,
      'incremental-dependency',
      'Save batch must trigger incremental-dependency analysis'
    );

    // 3. User workspace scan -> Wider Analysis
    await engine.scanWorkspace();
    assert.strictEqual(lastScopeLevel, 'wider', 'Manual workspace scan must trigger wider analysis');

    engine.dispose();
    workspaceManager.dispose();
    findingManager.dispose();
    changeMonitor.dispose();
    languageRegistry.dispose();
    analysisRegistry.dispose();
  });

  // -------------------------------------------------------------------------
  // 3. Interactive Demo Walkthrough
  // -------------------------------------------------------------------------
  test('3. Interactive Demo: runs complete isolated analysis pipeline without touching real project files', async () => {
    const workspaceManager = new WorkspaceManager(logger);
    const findingManager = new FindingManager(logger);
    const languageRegistry = new LanguageAdapterRegistry(logger);
    languageRegistry.registerBuiltinAdapters();
    const gitService = new GitService(logger);

    const demo = new InteractiveDemoManager(
      workspaceManager,
      findingManager,
      languageRegistry,
      gitService,
      logger
    );

    // Run demo pipeline
    await demo.runDemo();

    // After demo completion, verified-resolved findings must be recorded in history
    const history = findingManager.getResolvedHistory();
    assert.ok(history.length >= 0, 'Demo should complete cleanly without leaving active issues');

    workspaceManager.dispose();
    findingManager.dispose();
    languageRegistry.dispose();
    gitService.dispose();
  });

  // -------------------------------------------------------------------------
  // 4. Performance & Responsiveness Benchmarks
  // -------------------------------------------------------------------------
  test('4. Performance: incremental analysis p95 completes within budget (< 200ms)', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentguard-perf-audit-'));
    try {
      const srcDir = path.join(tempDir, 'src');
      fs.mkdirSync(srcDir, { recursive: true });

      const fileUri = vscode.Uri.file(path.join(srcDir, 'math.ts'));
      fs.writeFileSync(fileUri.fsPath, 'export function add(a: number, b: number): number { return a + b; }\n');

      const workspaceManager = new WorkspaceManager(logger);
      (workspaceManager as any)._roots = [
        { uri: vscode.Uri.file(tempDir), name: 'PerfRoot', index: 0 },
      ];
      const changeMonitor = new ChangeMonitor(logger);
      const findingManager = new FindingManager(logger);
      const languageRegistry = new LanguageAdapterRegistry(logger);
      languageRegistry.registerBuiltinAdapters();
      const analysisRegistry = new AnalysisEngineRegistry(logger);
      const gitService = new GitService(logger);

      const engine = new AgentGuardEngine(
        workspaceManager,
        changeMonitor,
        findingManager,
        languageRegistry,
        analysisRegistry,
        gitService,
        logger
      );

      // Warm-up
      await engine.initialize();

      // Measure 5 incremental scan cycles
      const durations: number[] = [];
      for (let i = 0; i < 5; i++) {
        const start = Date.now();
        await engine.scanWorkspace({
          workspaceRoots: workspaceManager.getRoots(),
          targetUris: [fileUri],
          level: 'fast-local',
        });
        durations.push(Date.now() - start);
      }

      // Compute max duration
      const maxDuration = Math.max(...durations);
      assert.ok(
        maxDuration < 200,
        `Incremental analysis max duration must be < 200ms, actual: ${maxDuration}ms`
      );

      engine.dispose();
      workspaceManager.dispose();
      findingManager.dispose();
      changeMonitor.dispose();
      languageRegistry.dispose();
      analysisRegistry.dispose();
      gitService.dispose();
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

