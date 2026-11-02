import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { AnalysisEngineRegistry } from '../../src/analysis/analyzer-registry';
import { BlastRadiusEngine } from '../../src/analysis/blast-radius/blast-radius-engine';
import { DiagnosticDeltaEngine } from '../../src/analysis/diagnostics/diagnostic-delta-engine';
import { DiagnosticTracker } from '../../src/analysis/diagnostics/diagnostic-tracker';
import { TypeScriptScopeAnalyzer } from '../../src/analysis/scope/typescript-scope-analyzer';
import { LogicWatchdogEngine } from '../../src/analysis/watchdog/watchdog-engine';
import { AgentGuardEngine } from '../../src/core/engine';
import { NullLogger } from '../../src/core/logger';
import { Finding } from '../../src/core/types';
import { FindingManager } from '../../src/findings/finding-manager';
import { GitService } from '../../src/git/git-service';
import { LanguageAdapterRegistry } from '../../src/languages/adapter-registry';
import { ChangeMonitor } from '../../src/monitoring/change-monitor';
import { ChangeProcessor } from '../../src/monitoring/change-processor';
import { IssuesPanelProvider } from '../../src/ui/panel/issues-panel-provider';
import { SidebarViewProvider } from '../../src/ui/sidebar/sidebar-view-provider';
import { DocumentContentReader } from '../../src/utils/document-content';
import { WorkspaceManager } from '../../src/workspace/workspace-manager';
import { mockVscode } from './mock-vscode';

suite('AgentGuard Final Master Suite: Ultra-Responsive Monitoring, UX & Full QA', function () {
  this.timeout(10000);

  let tempDir: string;
  let logger: NullLogger;
  let workspaceManager: WorkspaceManager;
  let changeMonitor: ChangeMonitor;
  let findingManager: FindingManager;
  let languageRegistry: LanguageAdapterRegistry;
  let analysisRegistry: AnalysisEngineRegistry;
  let gitService: GitService;
  let diagnosticTracker: DiagnosticTracker;
  let watchdogEngine: LogicWatchdogEngine;
  let blastRadiusEngine: BlastRadiusEngine;
  let engine: AgentGuardEngine;

  setup(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentguard-final-test-'));
    logger = new NullLogger();

    workspaceManager = new WorkspaceManager(logger);
    (workspaceManager as any)._roots = [
      {
        id: 'final-root',
        uri: vscode.Uri.file(tempDir),
        name: 'FinalRoot',
        fsPath: tempDir,
        index: 0,
      },
    ];

    changeMonitor = new ChangeMonitor(logger);
    findingManager = new FindingManager(logger);
    languageRegistry = new LanguageAdapterRegistry(logger);
    languageRegistry.registerBuiltinAdapters();

    analysisRegistry = new AnalysisEngineRegistry(logger);
    gitService = new GitService(logger);

    diagnosticTracker = new DiagnosticTracker(
      workspaceManager,
      languageRegistry,
      logger,
      undefined,
      gitService
    );

    watchdogEngine = new LogicWatchdogEngine(
      workspaceManager,
      languageRegistry,
      gitService,
      logger
    );
    analysisRegistry.registerEngine(watchdogEngine);

    blastRadiusEngine = new BlastRadiusEngine(
      workspaceManager,
      languageRegistry,
      diagnosticTracker,
      gitService,
      logger
    );
    analysisRegistry.registerEngine(blastRadiusEngine);

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

  teardown(async () => {
    engine.dispose();
    findingManager.dispose();
    changeMonitor.dispose();
    workspaceManager.dispose();
    mockVscode.workspace.textDocuments = [];
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  // =========================================================================
  // 1. TRUE LIVE CODE MONITORING WHILE TYPING (In-Memory Unsaved Documents)
  // =========================================================================
  test('1. Live Typing: Detects code modifications in unsaved open documents without saving', async () => {
    const authFilePath = path.join(tempDir, 'auth.service.ts');
    const authUri = vscode.Uri.file(authFilePath);

    // Initial baseline on disk
    const baselineCode = `
export class AuthService {
  public checkAdmin(user: any): boolean {
    if (user.role === 'admin') {
      return true;
    }
    return false;
  }
}
`;
    fs.writeFileSync(authFilePath, baselineCode, 'utf8');

    // Simulate developer opening the file in VS Code editor
    let currentInEditorText = baselineCode;
    const mockOpenDoc = {
      uri: authUri,
      getText: () => currentInEditorText,
      version: 1,
    };
    mockVscode.workspace.textDocuments = [mockOpenDoc];

    // Seed baseline in watchdog engine
    watchdogEngine.seedContentCache(authUri, baselineCode);

    // Step 1: Developer types and modifies condition
    currentInEditorText = `
export class AuthService {
  public checkAdmin(user: any): boolean {
    if (user.role) {
      return true;
    }
    return false;
  }
}
`;
    mockOpenDoc.version = 2;

    // Verify DocumentContentReader immediately reads the unsaved in-memory text
    const inMemText1 = await DocumentContentReader.readContent(authUri);
    assert.ok(inMemText1.includes('if (user.role)'), 'Must read live unsaved in-memory text');
    assert.strictEqual(
      fs.readFileSync(authFilePath, 'utf8'),
      baselineCode,
      'Disk file must remain untouched/unsaved'
    );

    // Step 2: Developer completely removes the auth guard while typing
    currentInEditorText = `
export class AuthService {
  public checkAdmin(user: any): boolean {
    return true;
  }
}
`;
    mockOpenDoc.version = 3;

    // Run fast-local typing analysis
    const findings1 = await watchdogEngine.analyze({
      workspaceRoots: workspaceManager.getRoots(),
      targetUris: [authUri],
      level: 'fast-local',
    });

    assert.ok(findings1.length > 0, 'Must detect removed authorization guard while typing');
    assert.strictEqual(findings1[0]!.ruleId, 'watchdog.authorization');
    assert.strictEqual(findings1[0]!.severity, 'error');

    // Step 3: Developer continues typing elsewhere in the file
    currentInEditorText = `
export class AuthService {
  public checkAdmin(user: any): boolean {
    console.log("auditing admin check");
    return true;
  }
}
`;
    mockOpenDoc.version = 4;

    // Analysis runs again on subsequent keystroke
    const findings2 = await watchdogEngine.analyze({
      workspaceRoots: workspaceManager.getRoots(),
      targetUris: [authUri],
      level: 'fast-local',
    });

    assert.ok(findings2.length > 0, 'Finding must remain active and stable across typing strokes');
    assert.strictEqual(findings2[0]!.ruleId, 'watchdog.authorization');

    // Step 4: Developer restores the auth check (Live Auto-Resolution)
    currentInEditorText = `
export class AuthService {
  public checkAdmin(user: any): boolean {
    if (user.role === 'admin') {
      return true;
    }
    return false;
  }
}
`;
    mockOpenDoc.version = 5;

    const findingsResolved = await watchdogEngine.analyze({
      workspaceRoots: workspaceManager.getRoots(),
      targetUris: [authUri],
      level: 'fast-local',
    });

    assert.strictEqual(
      findingsResolved.length,
      0,
      'Finding must automatically clear as soon as developer restores safety check'
    );
  });

  // =========================================================================
  // 2. INVISIBLE & CALM MONITORING (No continuous checking loop animation)
  // =========================================================================
  test('2. Calm Monitoring: Routine typing cycles do NOT flip engine state to analyzing or spam state changes', async () => {
    let stateChangeCount = 0;
    const sub = engine.onDidChangeState(() => {
      stateChangeCount++;
    });

    const fileUri = vscode.Uri.file(path.join(tempDir, 'demo.ts'));
    fs.writeFileSync(fileUri.fsPath, 'const a = 1;', 'utf8');

    // Dispatch 5 consecutive fast-local typing analysis cycles
    for (let i = 0; i < 5; i++) {
      await engine.scanWorkspace({
        workspaceRoots: workspaceManager.getRoots(),
        targetUris: [fileUri],
        level: 'fast-local',
      });
    }

    sub.dispose();

    // Fast-local typing checks must stay calm and not cycle through 'analyzing' -> 'ready'
    assert.strictEqual(
      stateChangeCount,
      0,
      'Fast-local typing checks must not trigger global engine state flips'
    );
    assert.strictEqual(engine.state, 'ready', 'Engine must remain in steady ready state');
  });

  // =========================================================================
  // 3. REMOVAL OF CONFUSING PAUSE & REFRESH CONTROLS FROM PRIMARY HEADER
  // =========================================================================
  test('3. Header Cleanliness: Pause and Refresh buttons are removed from the primary sidebar header', () => {
    const sidebarProvider = new SidebarViewProvider(
      vscode.Uri.file('/extension'),
      engine,
      workspaceManager,
      findingManager,
      changeMonitor
    );

    let html = '';
    const mockWebviewView = {
      webview: {
        options: {},
        onDidReceiveMessage: () => ({ dispose: () => {} }),
        set html(val: string) {
          html = val;
        },
        get html() {
          return html;
        },
      },
    } as unknown as vscode.WebviewView;

    sidebarProvider.resolveWebviewView(mockWebviewView, {} as any, {} as any);

    // Primary header must NOT contain confusing manual pause/refresh buttons
    assert.ok(!html.includes('id="btn-refresh"'), 'Primary header must not have Refresh button');
    assert.ok(!html.includes('id="btn-toggle"'), 'Primary header must not have Pause button');

    // Useful replacements must be present
    assert.ok(html.includes('status-badge'), 'Must include calm status badge');
    assert.ok(html.includes('id="header-count-pill"'), 'Must include issues count pill');
    assert.ok(html.includes('id="btn-panel"'), 'Must include quick panel action button');
    assert.ok(html.includes('id="btn-settings"'), 'Must include settings action button');
  });

  // =========================================================================
  // 4. SIDEBAR BLINKING & SCROLL CONTAINER STABILITY
  // =========================================================================
  test('4. UX Stability: Updates use postMessage delta without tearing down the Webview DOM', () => {
    const sidebarProvider = new SidebarViewProvider(
      vscode.Uri.file('/extension'),
      engine,
      workspaceManager,
      findingManager,
      changeMonitor
    );

    let htmlSetCount = 0;
    const postedMessages: any[] = [];

    const mockWebviewView = {
      webview: {
        options: {},
        onDidReceiveMessage: () => ({ dispose: () => {} }),
        set html(_val: string) {
          htmlSetCount++;
        },
        postMessage: async (msg: any) => {
          postedMessages.push(msg);
          return true;
        },
      },
    } as unknown as vscode.WebviewView;

    // Initial mount: html is set ONCE
    sidebarProvider.resolveWebviewView(mockWebviewView, {} as any, {} as any);
    assert.strictEqual(htmlSetCount, 1, 'HTML shell must be mounted exactly once');

    // Simulate findings arriving while user is scrolling or hovering
    findingManager.addFinding({
      id: 'live-f-1',
      ruleId: 'watchdog.auth',
      category: 'logic-risk',
      severity: 'error',
      confidence: 'high',
      evidenceClassification: 'confirmed-regression',
      status: 'open',
      title: 'Auth guard removed',
      message: 'Unsafe route',
      explanation: 'Missing check',
      evidence: '- auth()',
      location: {
        filePath: 'src/api.ts',
        uri: vscode.Uri.file('/workspace/src/api.ts'),
      },
      sourceEngine: 'watchdog',
      timestamp: Date.now(),
    });

    sidebarProvider.update();

    // Verification: html was NOT replaced a second time!
    assert.strictEqual(
      htmlSetCount,
      1,
      'Subsequent update must NEVER tear down webview.html (eliminating blinking & scroll jumps)'
    );

    // Verification: postMessage was dispatched with state delta
    assert.ok(postedMessages.length > 0, 'Update must be dispatched via postMessage');
    const lastMsg = postedMessages[postedMessages.length - 1];
    assert.strictEqual(lastMsg.type, 'stateUpdate');
    assert.strictEqual(lastMsg.data.totalActive, 1);
    assert.strictEqual(lastMsg.data.metrics.criticalCount, 1);
  });

  // =========================================================================
  // 5. ADAPTIVE SHORT DEBOUNCE (50ms typing vs 100ms saves)
  // =========================================================================
  test('5. Adaptive Debounce: ChangeProcessor flushes typing events rapidly within ~50ms', async () => {
    const processor = new ChangeProcessor(logger);
    let batchReceived = false;

    processor.onDidBatchReady(batch => {
      batchReceived = true;
      assert.strictEqual(batch.events[0]?.source, 'document');
    });

    const docUri = vscode.Uri.file(path.join(tempDir, 'editor.ts'));

    processor.enqueue({
      uri: docUri,
      kind: 'modified',
      source: 'document',
      timestamp: Date.now(),
    });

    // Wait 75ms (greater than 50ms typing debounce)
    await new Promise(resolve => setTimeout(resolve, 80));

    assert.strictEqual(batchReceived, true, 'Typing events must flush rapidly (~50ms)');
    processor.dispose();
  });

  // =========================================================================
  // 6. MULTI-LANGUAGE TEST: Python Security & Exception Handling
  // =========================================================================
  test('6. Multi-Language: Detects removed Python @login_required decorator and try/except while typing', async () => {
    const pyUri = vscode.Uri.file(path.join(tempDir, 'views.py'));
    const oldPy = `
@login_required
def profile_view(request):
    try:
        data = fetch_user(request.user)
        return render(request, 'profile.html', data)
    except UserNotFound:
        return redirect('/404')
`;
    fs.writeFileSync(pyUri.fsPath, oldPy, 'utf8');
    watchdogEngine.seedContentCache(pyUri, oldPy);

    // Live typing removes @login_required
    const newPy = `
def profile_view(request):
    data = fetch_user(request.user)
    return render(request, 'profile.html', data)
`;
    mockVscode.workspace.textDocuments = [
      { uri: pyUri, getText: () => newPy, version: 2 },
    ];

    const findings = await watchdogEngine.analyze({
      workspaceRoots: workspaceManager.getRoots(),
      targetUris: [pyUri],
      level: 'fast-local',
    });

    assert.ok(findings.length > 0, 'Must detect removed Python login_required decorator');
    assert.ok(
      findings.some(f => f.title.includes('Authentication') || (f.ruleId && f.ruleId.includes('auth'))),
      'Must flag authentication risk in Python view'
    );
  });

  // =========================================================================
  // 7. MULTI-LANGUAGE TEST: PHP / Laravel Middleware & Authorization
  // =========================================================================
  test('7. Multi-Language: Detects removed PHP/Laravel auth middleware', async () => {
    const phpUri = vscode.Uri.file(path.join(tempDir, 'UserController.php'));
    const oldPhp = `<?php
class UserController extends Controller {
    public function __construct() {
        $this->middleware('auth');
    }
    public function updateProfile(Request $request) {
        $user = Auth::user();
        $user->update($request->all());
    }
}
`;
    fs.writeFileSync(phpUri.fsPath, oldPhp, 'utf8');
    watchdogEngine.seedContentCache(phpUri, oldPhp);

    const newPhp = `<?php
class UserController extends Controller {
    public function updateProfile(Request $request) {
        $user = Auth::user();
        $user->update($request->all());
    }
}
`;
    mockVscode.workspace.textDocuments = [
      { uri: phpUri, getText: () => newPhp, version: 2 },
    ];

    const findings = await watchdogEngine.analyze({
      workspaceRoots: workspaceManager.getRoots(),
      targetUris: [phpUri],
      level: 'fast-local',
    });

    assert.ok(findings.length > 0, 'Must detect removed PHP middleware in controller');
    assert.strictEqual(findings[0]?.severity, 'error');
  });

  // =========================================================================
  // 8. MULTI-LANGUAGE TEST: C# / .NET Authorize Attribute Removal
  // =========================================================================
  test('8. Multi-Language: Detects removed C# [Authorize] attribute on Controller action', async () => {
    const csUri = vscode.Uri.file(path.join(tempDir, 'AdminController.cs'));
    const oldCs = `
[ApiController]
[Route("api/[controller]")]
public class AdminController : ControllerBase {
    [Authorize(Roles = "Admin")]
    [HttpPost("delete-user")]
    public IActionResult DeleteUser(int id) {
        _userService.Delete(id);
        return Ok();
    }
}
`;
    fs.writeFileSync(csUri.fsPath, oldCs, 'utf8');
    watchdogEngine.seedContentCache(csUri, oldCs);

    const newCs = `
[ApiController]
[Route("api/[controller]")]
public class AdminController : ControllerBase {
    [HttpPost("delete-user")]
    public IActionResult DeleteUser(int id) {
        _userService.Delete(id);
        return Ok();
    }
}
`;
    mockVscode.workspace.textDocuments = [
      { uri: csUri, getText: () => newCs, version: 2 },
    ];

    const findings = await watchdogEngine.analyze({
      workspaceRoots: workspaceManager.getRoots(),
      targetUris: [csUri],
      level: 'fast-local',
    });

    assert.ok(findings.length > 0, 'Must detect removed C# [Authorize] attribute');
    assert.strictEqual(findings[0]?.ruleId, 'watchdog.authorization');
  });

  // =========================================================================
  // 9. REACT & NEXT.JS: Broken Callback & Missing Import Accuracy
  // =========================================================================
  test('9. React & Next.js: ScopeResolver defines destructured params in .map() and external icons', () => {
    const reactCode = `
import React from 'react';
import { FaUser, FaLock } from 'react-icons/fa';

export const Dashboard = ({ items }: { items: Array<{ id: string; name: string }> }) => {
  return (
    <div>
      <FaUser />
      {items.map(({ id, name }) => (
        <span key={id}>{name}</span>
      ))}
    </div>
  );
};
`;
    const analyzer = new TypeScriptScopeAnalyzer();
    const result = analyzer.analyze(vscode.Uri.file('/workspace/dashboard.tsx'), reactCode);

    // id, name, FaUser, items must NOT be flagged as unresolved
    assert.strictEqual(
      result.undefinedIdentifiers.length,
      0,
      'Destructured parameters in React .map() and external icons must be resolved'
    );
  });

  // =========================================================================
  // 10. REAL-WORLD WORKFLOW: Rapid Character Typing Simulation
  // =========================================================================
  test('10. Real-World Workflow: Simulates 10 rapid keystrokes without race condition or duplicate findings', async () => {
    const targetUri = vscode.Uri.file(path.join(tempDir, 'rapid.ts'));
    fs.writeFileSync(targetUri.fsPath, 'export function run() {}', 'utf8');

    // Simulate 10 rapid keystrokes updating in-memory document text
    for (let charIndex = 0; charIndex < 10; charIndex++) {
      const liveText = `export function run() { console.log(${charIndex}); }`;
      mockVscode.workspace.textDocuments = [
        { uri: targetUri, getText: () => liveText, version: charIndex + 1 },
      ];

      // Dispatch incremental scan
      await engine.scanWorkspace({
        workspaceRoots: workspaceManager.getRoots(),
        targetUris: [targetUri],
        level: 'fast-local',
      });
    }

    // Zero active findings should exist for valid console.log edits
    const all = findingManager.getAll();
    assert.strictEqual(all.length, 0, 'Rapid typing must not emit false-positive findings');
  });

  // =========================================================================
  // 11. ACTUAL PERFORMANCE MEASUREMENTS (Event-to-UI Latency Budget)
  // =========================================================================
  test('11. Performance: Live in-memory content read duration (< 5ms) and fast-local analysis (< 50ms)', async () => {
    const perfUri = vscode.Uri.file(path.join(tempDir, 'perf.ts'));
    const perfCode = `
export function compute(a: number, b: number): number {
  if (a < 0) {
    throw new Error("negative");
  }
  return a + b;
}
`;
    fs.writeFileSync(perfUri.fsPath, perfCode, 'utf8');
    mockVscode.workspace.textDocuments = [
      { uri: perfUri, getText: () => perfCode, version: 1 },
    ];
    watchdogEngine.seedContentCache(perfUri, perfCode);

    // Measure in-memory document retrieval duration
    const t0 = process.hrtime.bigint();
    const content = await DocumentContentReader.readContent(perfUri);
    const t1 = process.hrtime.bigint();
    const docReadDurationMs = Number(t1 - t0) / 1_000_000;

    assert.ok(docReadDurationMs < 5, `In-memory read duration was ${docReadDurationMs.toFixed(2)}ms, expected < 5ms`);
    assert.strictEqual(content, perfCode);

    // Measure fast-local watchdog analysis duration
    const t2 = process.hrtime.bigint();
    await watchdogEngine.analyze({
      workspaceRoots: workspaceManager.getRoots(),
      targetUris: [perfUri],
      level: 'fast-local',
    });
    const t3 = process.hrtime.bigint();
    const fastLocalDurationMs = Number(t3 - t2) / 1_000_000;

    assert.ok(
      fastLocalDurationMs < 50,
      `Fast-local analysis duration was ${fastLocalDurationMs.toFixed(2)}ms, expected < 50ms`
    );
  });
});
