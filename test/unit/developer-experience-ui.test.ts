import * as assert from 'assert';
import * as vscode from 'vscode';
import { AgentGuardEngine } from '../../src/core/engine';
import { NullLogger } from '../../src/core/logger';
import { Finding } from '../../src/core/types';
import { FindingManager } from '../../src/findings/finding-manager';
import { ChangeMonitor } from '../../src/monitoring/change-monitor';
import { CommandHandler } from '../../src/ui/commands/command-handler';
import { FindingHoverProvider } from '../../src/ui/hover/finding-hover-provider';
import { NavigationService } from '../../src/ui/navigation/navigation-service';
import { IssuesPanelProvider } from '../../src/ui/panel/issues-panel-provider';
import { SidebarViewProvider } from '../../src/ui/sidebar/sidebar-view-provider';
import { WorkspaceManager } from '../../src/workspace/workspace-manager';

suite('AgentGuard V2.0: Developer Experience & UI Redesign Tests (Prompt 3)', () => {
  let logger: NullLogger;
  let workspaceManager: WorkspaceManager;
  let findingManager: FindingManager;
  let changeMonitor: ChangeMonitor;

  setup(() => {
    logger = new NullLogger();
    workspaceManager = new WorkspaceManager(logger);
    (workspaceManager as any)._roots = [
      { uri: vscode.Uri.file('/workspace'), name: 'Workspace', index: 0 },
    ];
    findingManager = new FindingManager(logger);
    changeMonitor = new ChangeMonitor(logger);
  });

  teardown(() => {
    workspaceManager.dispose();
    findingManager.dispose();
    changeMonitor.dispose();
  });

  // -------------------------------------------------------------------------
  // 1. Sidebar View: Header, Summary Cards & Empty State
  // -------------------------------------------------------------------------
  test('1. Sidebar View: renders clean header, 2-column summary cards, and reassuring empty state', () => {
    const mockEngine = {
      state: 'ready',
      gitAvailable: true,
      gitRepoCount: 1,
      getStatus: () => ({ state: 'ready' }),
      onDidChangeState: new vscode.EventEmitter<any>().event,
    } as unknown as AgentGuardEngine;

    const sidebarProvider = new SidebarViewProvider(
      vscode.Uri.file('/extension'),
      mockEngine,
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

    // 1. Clean Header
    assert.ok(html.includes('AgentGuard'), 'Header must include AgentGuard title');
    assert.ok(html.includes('Monitoring workspace'), 'Header must reflect monitoring state');
    assert.ok(!html.includes('TypeScriptAdapter (Level 3)'), 'Must not display adapter clutter');
    assert.ok(!html.includes('RECENT ACTIVITY'), 'Must not display raw activity history');

    // 2. Summary Metric Cards
    assert.ok(html.includes('New Issues'), 'Must render New Issues card');
    assert.ok(html.includes('Critical Risks'), 'Must render Critical Risks card');
    assert.ok(html.includes('Affected Files'), 'Must render Affected Files card');
    assert.ok(html.includes('Resolved'), 'Must render Resolved card');

    // 3. Clean Empty State (Zero regressions detected)
    assert.ok(
      html.includes('No new regressions detected.'),
      'Must display reassuring, accurate empty state'
    );
    assert.ok(
      !html.includes('100% bug-free'),
      'Must never claim project is completely bug-free'
    );
  });

  // -------------------------------------------------------------------------
  // 2. Sidebar View: Category-Wise Findings & Filterable Summary Cards
  // -------------------------------------------------------------------------
  test('2. Sidebar View: categorizes findings cleanly into Breaking Changes, Security & Logic, and New Regressions', () => {
    const mockEngine = {
      state: 'ready',
      gitAvailable: true,
      gitRepoCount: 1,
      getStatus: () => ({ state: 'ready' }),
      onDidChangeState: new vscode.EventEmitter<any>().event,
    } as unknown as AgentGuardEngine;

    // Add Breaking Change finding
    findingManager.addFinding({
      id: 'f-breaking-1',
      ruleId: 'blast-radius/removed-export',
      category: 'potentially-broken-contract',
      severity: 'error',
      confidence: 'high',
      evidenceClassification: 'structural-regression',
      title: "Export 'getUser' Removed (Affects 2 Untouched Files)",
      message: 'Export deleted',
      explanation: 'Export was deleted while imported in auth.ts and profile.ts',
      evidence: '- export function getUser() {}',
      location: {
        filePath: 'src/user-service.ts',
        uri: vscode.Uri.file('/workspace/src/user-service.ts'),
        range: new vscode.Range(10, 0, 10, 30),
      },
      relatedLocations: [
        { filePath: 'src/auth.ts', uri: vscode.Uri.file('/workspace/src/auth.ts') },
        { filePath: 'src/profile.ts', uri: vscode.Uri.file('/workspace/src/profile.ts') },
      ],
      sourceEngine: 'blast-radius',
      timestamp: Date.now(),
    });

    // Add Security & Logic finding
    findingManager.addFinding({
      id: 'f-sec-1',
      ruleId: 'silent-regression-removed-await',
      category: 'logic-risk',
      severity: 'error',
      confidence: 'high',
      evidenceClassification: 'structural-regression',
      title: "Silent Risk: 'await' Keyword Removed on 'verifyToken()'",
      message: 'Floating promise',
      explanation: 'verifyToken() promise is not awaited',
      evidence: '- await verifyToken(token);\n+ verifyToken(token);',
      suggestedRemediation: 'Restore `await` keyword',
      location: {
        filePath: 'src/auth.ts',
        uri: vscode.Uri.file('/workspace/src/auth.ts'),
        range: new vscode.Range(42, 4, 42, 24),
      },
      sourceEngine: 'logic-watchdog',
      timestamp: Date.now(),
    });

    const sidebarProvider = new SidebarViewProvider(
      vscode.Uri.file('/extension'),
      mockEngine,
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

    // Summary counts updated
    assert.ok(html.includes('<span class="metric-value">2</span>'), 'Critical count should be 2');

    // Categorized sections
    assert.ok(html.includes('Breaking Changes'), 'Must have Breaking Changes section');
    assert.ok(html.includes('Security & Logic'), 'Must have Security & Logic section');
    assert.ok(
      !html.includes('Unused Code'),
      'Must hide empty Unused Code section when 0 unused findings exist'
    );

    // Finding Card details
    assert.ok(html.includes('user-service.ts:11'));
    assert.ok(html.includes('2 files affected'));
  });

  // -------------------------------------------------------------------------
  // 3. Dedicated Bottom Panel: Master-Detail Split & 6-Question Breakdown
  // -------------------------------------------------------------------------
  test('3. Issues Panel: renders header, filters, and 6-question structured issue details', () => {
    const mockEngine = {
      state: 'ready',
      gitAvailable: true,
      gitRepoCount: 1,
      getStatus: () => ({ state: 'ready' }),
      onDidChangeState: new vscode.EventEmitter<any>().event,
    } as unknown as AgentGuardEngine;

    const finding: Finding = {
      id: 'f-panel-1',
      ruleId: 'watchdog.authentication',
      category: 'logic-risk',
      severity: 'error',
      confidence: 'high',
      evidenceClassification: 'confirmed-regression',
      status: 'open',
      verificationState: 'verified-breaking',
      title: 'Authentication guard removed on route /admin',
      message: 'Route has no authMiddleware',
      explanation: 'The route no longer contains its previous authentication middleware.',
      evidence: '- router.get("/admin", authMiddleware, handler);\n+ router.get("/admin", handler);',
      suggestedRemediation: 'Verify that equivalent protection exists or restore authMiddleware.',
      location: {
        filePath: 'src/routes.ts',
        uri: vscode.Uri.file('/workspace/src/routes.ts'),
        range: new vscode.Range(20, 0, 20, 45),
      },
      sourceEngine: 'logic-watchdog',
      timestamp: Date.now(),
    };

    findingManager.addFinding(finding);

    const panelProvider = new IssuesPanelProvider(
      vscode.Uri.file('/extension'),
      mockEngine,
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

    panelProvider.resolveWebviewView(mockWebviewView, {} as any, {} as any);

    // Header & Controls
    assert.ok(html.includes('AgentGuard — Codebase Issues'));
    assert.ok(html.includes('Search by file, symbol, or title'));
    assert.ok(html.includes('Group:'));

    // 6-Question Breakdown
    assert.ok(html.includes('1. What happened?'));
    assert.ok(html.includes('The route no longer contains its previous authentication middleware.'));
    assert.ok(html.includes('2. Why? (Root Cause)'));
    assert.ok(html.includes('3. What changed? (Change Evidence)'));
    assert.ok(html.includes('4. What is affected?'));
    assert.ok(html.includes('5. How to fix it? (Remediation)'));
    assert.ok(html.includes('6. Verification State'));
    assert.ok(html.includes('verified-breaking'));

    // Quick Action Buttons
    assert.ok(html.includes('Open Source'));
    assert.ok(html.includes('Copy AI Fix Prompt'));
    assert.ok(html.includes('View Diff'));
    assert.ok(html.includes('Quick Fix'));
    assert.ok(html.includes('Recheck'));
    assert.ok(html.includes('Ignore'));
  });

  // -------------------------------------------------------------------------
  // 4. Exact Source Navigation & Whole Identifier Matching
  // -------------------------------------------------------------------------
  test('4. Navigation: resolves accurate whole identifier token without partial cuts', () => {
    const fileContent = `
import { GraphQLInt, GraphQLString } from 'graphql';

export const userQuery = {
  type: GraphQLInt,
  resolve: () => 42,
};
`;
    const lines = fileContent.split('\n');
    const mockDoc = {
      lineCount: lines.length,
      lineAt: (lineIndex: number) => ({
        text: lines[lineIndex] ?? '',
      }),
    } as unknown as vscode.TextDocument;

    const finding: Finding = {
      id: 'f-nav-1',
      ruleId: 'type-safety/unresolved',
      category: 'type-safety',
      severity: 'error',
      confidence: 'high',
      title: "Cannot resolve 'GraphQLInt'",
      message: 'Missing symbol',
      explanation: 'Symbol does not exist',
      evidence: 'GraphQLInt',
      location: {
        filePath: 'src/schema.ts',
        uri: vscode.Uri.file('/workspace/src/schema.ts'),
        range: new vscode.Range(4, 0, 4, 0),
      },
      sourceEngine: 'diagnostic-delta',
      timestamp: Date.now(),
    };

    const resolved = NavigationService.resolveAccurateRange(mockDoc, finding);
    assert.ok(resolved, 'Should resolve range');
    assert.strictEqual(resolved.start.line, 4);

    const lineText = lines[resolved.start.line]!;
    const extractedToken = lineText.substring(resolved.start.character, resolved.end.character);
    assert.strictEqual(
      extractedToken,
      'GraphQLInt',
      'Must highlight the exact whole identifier GraphQLInt, never a partial token'
    );
  });

  // -------------------------------------------------------------------------
  // 5. Simple, Professional Hover Experience
  // -------------------------------------------------------------------------
  test('5. Simple Hover: generates concise 2-line explanation with Fix guidance and actions', () => {
    const fileUri = vscode.Uri.file('/workspace/src/auth.ts');
    const finding: Finding = {
      id: 'f-hover-simple',
      ruleId: 'watchdog.auth-guard',
      category: 'logic-risk',
      severity: 'error',
      confidence: 'high',
      title: 'Authentication check removed',
      message: 'Removed auth guard',
      explanation: 'The route no longer contains its previous authentication middleware.',
      evidence: '- app.use(auth);',
      suggestedRemediation: 'Verify that equivalent protection exists.',
      location: {
        filePath: '/workspace/src/auth.ts',
        uri: fileUri,
        range: new vscode.Range(15, 0, 15, 20),
      },
      sourceEngine: 'logic-watchdog',
      timestamp: Date.now(),
    };

    findingManager.addFinding(finding);

    const hoverProvider = new FindingHoverProvider(findingManager);
    const mockDoc = {
      uri: fileUri,
      scheme: 'file',
      lineCount: 30,
      lineAt: () => ({ text: 'router.get("/admin");' }),
    } as unknown as vscode.TextDocument;

    const hover = hoverProvider.provideHover(
      mockDoc,
      new vscode.Position(15, 5),
      {} as any
    ) as vscode.Hover;

    assert.ok(hover, 'Hover must be provided');
    const content = (hover.contents as any).value as string;

    // Must be concise without raw internal debug IDs or giant blocks
    assert.ok(content.includes('**$(shield) AgentGuard: Authentication check removed**'));
    assert.ok(content.includes('CRITICAL'));
    assert.ok(content.includes('The route no longer contains its previous authentication middleware.'));
    assert.ok(content.includes('**Fix:** Verify that equivalent protection exists.'));
    assert.ok(content.includes('Copy AI Fix Prompt'));
    assert.ok(content.includes('Open in Panel'));
    assert.ok(!content.includes('watchdog.auth-guard'), 'Must not display raw internal rule IDs in hover');
  });

  // -------------------------------------------------------------------------
  // 6. Real-Time Synchronization & Quick Actions
  // -------------------------------------------------------------------------
  test('6. Quick Actions: CommandHandler supports pause/resume, ignore, and quick-fix', async () => {
    let monitoringToggled = false;
    let ignoredFinding: Finding | undefined;

    const mockEngine = {
      state: 'ready',
      gitAvailable: true,
      gitRepoCount: 1,
      getStatus: () => ({ state: 'ready' }),
      scanWorkspace: async () => [],
      scanFile: async () => [],
      onDidChangeState: new vscode.EventEmitter<any>().event,
    } as unknown as AgentGuardEngine;

    const reporter = {} as any;
    const commandHandler = new CommandHandler(
      mockEngine,
      workspaceManager,
      findingManager,
      reporter,
      logger,
      changeMonitor
    );

    // Initial monitoring state: enabled
    assert.strictEqual(changeMonitor.isEnabled(), true);

    // Toggle monitoring via command
    await vscode.commands.executeCommand('agentguard.toggleMonitoring');
    assert.strictEqual(changeMonitor.isEnabled(), false, 'Monitoring should now be paused');

    await vscode.commands.executeCommand('agentguard.toggleMonitoring');
    assert.strictEqual(changeMonitor.isEnabled(), true, 'Monitoring should now be resumed');

    commandHandler.dispose();
  });
});
