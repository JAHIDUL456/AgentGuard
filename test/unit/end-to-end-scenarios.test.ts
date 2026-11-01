import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { AnalysisEngineRegistry } from '../../src/analysis/analyzer-registry';
import { BlastRadiusEngine } from '../../src/analysis/blast-radius/blast-radius-engine';
import { DiagnosticDeltaEngine } from '../../src/analysis/diagnostics/diagnostic-delta-engine';
import { DiagnosticTracker } from '../../src/analysis/diagnostics/diagnostic-tracker';
import { LogicWatchdogEngine } from '../../src/analysis/watchdog/watchdog-engine';
import { AgentGuardEngine } from '../../src/core/engine';
import { NullLogger } from '../../src/core/logger';
import { Finding } from '../../src/core/types';
import { FindingManager } from '../../src/findings/finding-manager';
import { NativeDiagnosticsPublisher } from '../../src/findings/native-diagnostics';
import { GitService } from '../../src/git/git-service';
import { LanguageAdapterRegistry } from '../../src/languages/adapter-registry';
import { ChangeMonitor } from '../../src/monitoring/change-monitor';
import { ChangeQueue } from '../../src/monitoring/change-queue';
import { AutoReportManager } from '../../src/reporting/auto-reporter';
import { MarkdownReporter } from '../../src/reporting/markdown-reporter';
import { StatusBarManager } from '../../src/ui/status-bar/status-bar-manager';
import { AgentGuardTreeProvider } from '../../src/ui/tree/agentguard-tree-provider';
import { SectionTreeItem } from '../../src/ui/tree/tree-items';
import { WorkspaceManager } from '../../src/workspace/workspace-manager';
import { mockVscode } from './mock-vscode';

const vscode = mockVscode as any;

suite('Stage 8: Comprehensive End-to-End Scenarios (A through F)', function () {
  this.timeout(10000);

  let tempDir: string;
  let logger: NullLogger;

  setup(() => {
    tempDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agentguard-e2e-')));
    logger = new NullLogger();
  });

  teardown(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  // SCENARIO A
  test('Scenario A: TypeScript Auth Service modification detects untouched references, updates UI and report', async () => {
    const wsDir = path.join(tempDir, 'ts-project');
    const srcDir = path.join(wsDir, 'src');
    fs.mkdirSync(srcDir, { recursive: true });

    const authFile = path.join(srcDir, 'auth.ts');
    const apiFile = path.join(srcDir, 'api.ts');

    const oldAuthCode = `
      export function verifyToken(token: string): boolean {
        return token.length > 10;
      }
    `;
    const newAuthCode = `
      export function verifyJwtToken(token: string): boolean {
        return token.length > 10;
      }
    `;
    const apiCode = `
      import { verifyToken } from './auth';

      export function handleRequest(token: string) {
        if (!verifyToken(token)) {
          throw new Error('Unauthorized');
        }
        return { status: 200 };
      }
    `;

    fs.writeFileSync(authFile, newAuthCode);
    fs.writeFileSync(apiFile, apiCode);

    const workspaceManager = new WorkspaceManager(logger);
    (workspaceManager as any)._roots = [
      {
        id: 'ws-ts',
        uri: vscode.Uri.file(wsDir),
        name: 'TS-Project',
        fsPath: wsDir,
        index: 0,
      },
    ];

    const changeMonitor = new ChangeMonitor(logger);
    const findingManager = new FindingManager(logger);
    const languageRegistry = new LanguageAdapterRegistry(logger);
    languageRegistry.registerBuiltinAdapters();

    const analysisRegistry = new AnalysisEngineRegistry(logger);
    const gitService = new GitService(logger);
    const diagnosticTracker = new DiagnosticTracker(
      workspaceManager,
      languageRegistry,
      logger
    );

    const blastRadiusEngine = new BlastRadiusEngine(
      workspaceManager,
      languageRegistry,
      diagnosticTracker,
      gitService,
      logger
    );
    analysisRegistry.registerEngine(blastRadiusEngine);
    (diagnosticTracker as any)._isBaselineReady = true;

    // Seed AST for authFile representing the previous baseline version
    const tsAdapter = languageRegistry.getAdapterById('typescript')!;
    const oldStructure = await tsAdapter.parseStructure(vscode.Uri.file(authFile), oldAuthCode);
    blastRadiusEngine.seedAstCache(vscode.Uri.file(authFile), oldStructure.nodes);

    const engine = new AgentGuardEngine(
      workspaceManager,
      changeMonitor,
      findingManager,
      languageRegistry,
      analysisRegistry,
      gitService,
      logger
    );
    await engine.initialize();

    const statusBar = new StatusBarManager(engine, workspaceManager, findingManager, diagnosticTracker);
    const treeProvider = new AgentGuardTreeProvider(engine, workspaceManager, findingManager, languageRegistry);
    const reporter = new MarkdownReporter();
    const autoReporter = new AutoReportManager(
      engine,
      workspaceManager,
      findingManager,
      languageRegistry,
      reporter,
      logger,
      10
    );

    // Trigger analysis targeting the changed auth file
    const findings = await blastRadiusEngine.analyze({
      workspaceRoots: (workspaceManager as any)._roots,
      targetUris: [vscode.Uri.file(authFile)],
    });

    findingManager.setFindings(blastRadiusEngine.id, findings);

    // 1. Verify finding identifies untouched consumer file
    assert.ok(findings.length > 0, 'Should produce blast radius findings');
    const finding = findings[0]!;
    assert.ok(
      finding.category === 'potentially-affected-dependency' || finding.category === 'unresolved-reference',
      `Category should indicate blast-radius dependency issue, got: ${finding.category}`
    );
    assert.ok(finding.location.filePath.includes('api.ts'), 'Untouched api.ts should be identified');
    assert.strictEqual(finding.confidence, 'high');

    // 2. Verify status bar reflects issues
    assert.ok(
      statusBar.item.text.includes('Issue Detected') || statusBar.item.text.includes('Issues Detected'),
      `Status bar should indicate issues detected, got: ${statusBar.item.text}`
    );

    // 3. Verify native tree provider displays WARNINGS / CRITICAL
    const rootSections = await treeProvider.getChildren();
    const warningSection = rootSections.find(s => s.label === 'WARNINGS' || s.label === 'CRITICAL');
    assert.ok(warningSection, 'Tree must show WARNINGS or CRITICAL section');

    // 4. Verify automatic report file is updated
    await autoReporter.forceUpdate();
    const reportPath = path.join(wsDir, '.vscode', 'agentguard-report.md');
    assert.ok(fs.existsSync(reportPath), 'Safety report must be generated');
    const reportContent = fs.readFileSync(reportPath, 'utf8');
    assert.ok(reportContent.includes('api.ts'));
    assert.ok(reportContent.includes('AI Coding Agent Handoff Instruction'));

    autoReporter.dispose();
    statusBar.dispose();
    engine.dispose();
  });

  // SCENARIO B
  test('Scenario B: Python validation branch removal reports safety risk only with evidence', async () => {
    const wsDir = path.join(tempDir, 'py-project');
    fs.mkdirSync(wsDir, { recursive: true });

    const pyFile = path.join(wsDir, 'validator.py');
    const oldCode = `
def process_order(data):
    if not data.get("user_id"):
        raise ValueError("user_id is required")
    if data.get("amount", 0) <= 0:
        raise ValueError("Invalid amount")
    return save_order(data)
`;
    const newCode = `
def process_order(data):
    # removed user_id check
    if data.get("amount", 0) <= 0:
        raise ValueError("Invalid amount")
    return save_order(data)
`;

    fs.writeFileSync(pyFile, newCode);

    const workspaceManager = new WorkspaceManager(logger);
    (workspaceManager as any)._roots = [
      {
        id: 'ws-py',
        uri: vscode.Uri.file(wsDir),
        name: 'Py-Project',
        fsPath: wsDir,
        index: 0,
      },
    ];

    const gitService = new GitService(logger);
    const languageRegistry = new LanguageAdapterRegistry(logger);
    languageRegistry.registerBuiltinAdapters();

    const watchdog = new LogicWatchdogEngine(workspaceManager, languageRegistry, gitService, logger);
    watchdog.seedContentCache(vscode.Uri.file(pyFile), oldCode);

    // 1. Positive case: removed validation produces finding
    const findings = await watchdog.analyze({
      workspaceRoots: (workspaceManager as any)._roots,
      targetUris: [vscode.Uri.file(pyFile)],
    });

    assert.ok(findings.length >= 1, 'Should produce evidence-backed finding for removed validation');
    const authFinding = findings[0]!;
    assert.strictEqual(authFinding.category, 'logic-risk');
    assert.ok(
      authFinding.evidence.includes('user_id') || authFinding.evidence.includes('data.get'),
      'Evidence should cite the removed validation check'
    );
    assert.ok(authFinding.message.toLowerCase().includes('validation'));

    // 2. Negative case: safe comment/whitespace modification produces 0 findings
    const whitespaceOnlyCode = `
def process_order(data):
    # Just updated a comment
    if not data.get("user_id"):
        raise ValueError("user_id is required")
    if data.get("amount", 0) <= 0:
        raise ValueError("Invalid amount")
    return save_order(data)
`;
    fs.writeFileSync(pyFile, whitespaceOnlyCode);
    watchdog.seedContentCache(vscode.Uri.file(pyFile), oldCode);

    const safeFindings = await watchdog.analyze({
      workspaceRoots: (workspaceManager as any)._roots,
      targetUris: [vscode.Uri.file(pyFile)],
    });
    assert.strictEqual(safeFindings.length, 0, 'Comment/formatting changes must not produce false positive');
  });

  // SCENARIO C
  test('Scenario C: Laravel PHP authorization change reports supported AST findings and honest limitations', async () => {
    const wsDir = path.join(tempDir, 'php-project');
    fs.mkdirSync(wsDir, { recursive: true });

    const phpFile = path.join(wsDir, 'PostController.php');
    const oldCode = `<?php
namespace App\\Http\\Controllers;

class PostController {
    public function update(Request $request, $id) {
        $this->authorize('update-post', $id);
        return Post::update($request->all());
    }
}
`;
    const newCode = `<?php
namespace App\\Http\\Controllers;

class PostController {
    public function update(Request $request, $id) {
        // authorize call deleted
        return Post::update($request->all());
    }
}
`;
    fs.writeFileSync(phpFile, newCode);

    const workspaceManager = new WorkspaceManager(logger);
    (workspaceManager as any)._roots = [
      {
        id: 'ws-php',
        uri: vscode.Uri.file(wsDir),
        name: 'PHP-Project',
        fsPath: wsDir,
        index: 0,
      },
    ];

    const gitService = new GitService(logger);
    const languageRegistry = new LanguageAdapterRegistry(logger);
    languageRegistry.registerBuiltinAdapters();

    const watchdog = new LogicWatchdogEngine(workspaceManager, languageRegistry, gitService, logger);
    watchdog.seedContentCache(vscode.Uri.file(phpFile), oldCode);

    const findings = await watchdog.analyze({
      workspaceRoots: (workspaceManager as any)._roots,
      targetUris: [vscode.Uri.file(phpFile)],
    });

    // 1. Detects authorization call removal via AST & line diff
    assert.ok(findings.length >= 1, 'Should detect removed authorization check');
    assert.strictEqual(findings[0]!.category, 'logic-risk');
    assert.ok(
      findings[0]!.title.includes('Access-control') || findings[0]!.title.includes('Authorization'),
      'Finding title should cite access-control or authorization removal'
    );

    // 2. Verify PHP adapter reports honest capability level (Level 3) and limitations
    const phpAdapter = languageRegistry.getAdapterById('php')!;
    assert.strictEqual(phpAdapter.capabilityLevel, 3);
    assert.ok(
      phpAdapter.knownLimitations.some(l => l.includes('Dynamic') || l.includes('Autoloader')),
      'PHP adapter must declare its known limitations'
    );
  });

  // SCENARIO D
  test('Scenario D: AI coding tool modifies several files externally; change queue coalesces batch', async () => {
    const wsDir = path.join(tempDir, 'ai-edit-project');
    const srcDir = path.join(wsDir, 'src');
    fs.mkdirSync(srcDir, { recursive: true });

    const fileA = path.join(srcDir, 'model.ts');
    const fileB = path.join(srcDir, 'controller.ts');
    const fileC = path.join(srcDir, 'routes.ts');

    fs.writeFileSync(fileA, 'export class Model {}');
    fs.writeFileSync(fileB, 'export class Controller {}');
    fs.writeFileSync(fileC, 'export class Routes {}');

    const queue = new ChangeQueue();

    // Simulate AI tool writing 3 files rapidly
    const events = [
      { kind: 'modified' as const, uri: vscode.Uri.file(fileA), timestamp: Date.now(), source: 'watcher' as const },
      { kind: 'modified' as const, uri: vscode.Uri.file(fileB), timestamp: Date.now(), source: 'watcher' as const },
      { kind: 'modified' as const, uri: vscode.Uri.file(fileC), timestamp: Date.now(), source: 'watcher' as const },
    ];

    for (const e of events) {
      queue.enqueue(e);
    }

    assert.strictEqual(queue.size, 3);
    const batch = queue.dequeueAll();
    assert.strictEqual(batch.length, 3, 'All 3 externally modified files should be drained together in one batch');
  });

  // SCENARIO E
  test('Scenario E: Non-Git workspace continues generic monitoring and available diagnostics cleanly', async () => {
    const nonGitDir = path.join(tempDir, 'no-git');
    fs.mkdirSync(nonGitDir, { recursive: true });

    const workspaceManager = new WorkspaceManager(logger);
    (workspaceManager as any)._roots = [
      {
        id: 'ws-no-git',
        uri: vscode.Uri.file(nonGitDir),
        name: 'NoGitWorkspace',
        fsPath: nonGitDir,
        index: 0,
      },
    ];

    const changeMonitor = new ChangeMonitor(logger);
    const findingManager = new FindingManager(logger);
    const languageRegistry = new LanguageAdapterRegistry(logger);
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

    // Initialize without Git
    await engine.initialize();
    assert.strictEqual(engine.state, 'ready');
    assert.strictEqual(engine.gitRepoCount, 0, 'No workspace root should have git repo');
    assert.strictEqual(
      engine.gitAvailable && engine.gitRepoCount > 0,
      false,
      'Must operate in fallback file monitoring mode'
    );

    const statusBar = new StatusBarManager(
      engine,
      workspaceManager,
      findingManager,
      new DiagnosticTracker(workspaceManager, languageRegistry, logger)
    );
    assert.ok(
      statusBar.item.text.includes('All Clear') || statusBar.item.text.includes('AgentGuard'),
      'Status bar should function normally without git'
    );

    statusBar.dispose();
    engine.dispose();
  });

  // SCENARIO F
  test('Scenario F: Multi-root workspace with TS and Go maintains isolated findings and reports', async () => {
    const rootTS = path.join(tempDir, 'frontend-ts');
    const rootGo = path.join(tempDir, 'backend-go');
    fs.mkdirSync(rootTS, { recursive: true });
    fs.mkdirSync(rootGo, { recursive: true });

    const workspaceManager = new WorkspaceManager(logger);
    const rootUriTS = vscode.Uri.file(rootTS);
    const rootUriGo = vscode.Uri.file(rootGo);

    (workspaceManager as any)._roots = [
      { id: 'ts-root', uri: rootUriTS, name: 'FrontendTS', fsPath: rootTS, index: 0 },
      { id: 'go-root', uri: rootUriGo, name: 'BackendGo', fsPath: rootGo, index: 1 },
    ];

    const findingManager = new FindingManager(logger);

    // Finding in Frontend
    const findingTS: Finding = {
      id: 'f-ts-1',
      category: 'confirmed-new-diagnostic',
      severity: 'error',
      confidence: 'high',
      title: 'TS Error',
      message: 'Type mismatch in component',
      evidence: 'Line 20',
      explanation: 'TypeScript compilation failure',
      location: {
        filePath: 'src/App.tsx',
        uri: vscode.Uri.file(path.join(rootTS, 'src/App.tsx')),
        workspaceRootUri: rootUriTS,
      },
      sourceEngine: 'diagnostic-delta',
      timestamp: Date.now(),
    };

    // Finding in Backend
    const findingGo: Finding = {
      id: 'f-go-1',
      category: 'logic-risk',
      severity: 'warning',
      confidence: 'high',
      title: 'Go Error Handling Removed',
      message: 'Ignored err return',
      evidence: 'Line 45',
      explanation: 'Silent failure risk',
      location: {
        filePath: 'server.go',
        uri: vscode.Uri.file(path.join(rootGo, 'server.go')),
        workspaceRootUri: rootUriGo,
      },
      sourceEngine: 'logic-watchdog',
      timestamp: Date.now(),
    };

    findingManager.addFinding(findingTS);
    findingManager.addFinding(findingGo);

    // Verify finding isolation by root
    const tsFindings = findingManager.getAll().filter(
      f => f.location.workspaceRootUri?.fsPath === rootTS
    );
    const goFindings = findingManager.getAll().filter(
      f => f.location.workspaceRootUri?.fsPath === rootGo
    );

    assert.strictEqual(tsFindings.length, 1);
    assert.strictEqual(tsFindings[0]!.title, 'TS Error');
    assert.strictEqual(goFindings.length, 1);
    assert.strictEqual(goFindings[0]!.title, 'Go Error Handling Removed');

    // Clear findings only for Frontend
    findingManager.clearByWorkspace(rootUriTS);
    assert.strictEqual(
      findingManager.getAll().some(f => f.location.workspaceRootUri?.fsPath === rootTS),
      false,
      'Frontend findings should be cleared'
    );
    assert.strictEqual(
      findingManager.getAll().some(f => f.location.workspaceRootUri?.fsPath === rootGo),
      true,
      'Backend findings must remain intact'
    );

    findingManager.dispose();
  });
});
