import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { BlastRadiusEngine } from '../../src/analysis/blast-radius/blast-radius-engine';
import { DiagnosticTracker } from '../../src/analysis/diagnostics/diagnostic-tracker';
import { SilentRegressionRule } from '../../src/analysis/watchdog/rules/silent-regression-rule';
import { NullLogger } from '../../src/core/logger';
import { Finding } from '../../src/core/types';
import { FindingManager } from '../../src/findings/finding-manager';
import { NativeDiagnosticsPublisher } from '../../src/findings/native-diagnostics';
import { GitService } from '../../src/git/git-service';
import { LanguageAdapterRegistry } from '../../src/languages/adapter-registry';
import { ChangeMonitor } from '../../src/monitoring/change-monitor';
import { CommandHandler } from '../../src/ui/commands/command-handler';
import { FindingHoverProvider } from '../../src/ui/hover/finding-hover-provider';
import { WorkspaceManager } from '../../src/workspace/workspace-manager';

suite('AgentGuard V2.0: Live Monitoring, Diagnostics & Finding Lifecycle Tests', () => {
  let logger: NullLogger;

  setup(() => {
    logger = new NullLogger();
  });

  // -------------------------------------------------------------------------
  // 1. Change Monitoring & Diagnostic Loop Prevention
  // -------------------------------------------------------------------------
  test('1. Monitoring: captures file events and filters out AgentGuard diagnostics to prevent loops', done => {
    const monitor = new ChangeMonitor(logger, { debounceMs: 20, maxWaitMs: 50 });
    monitor.setEnabled(true);

    const fileUri = vscode.Uri.file('/workspace/src/app.ts');

    // First: fire diagnostic update where ALL diagnostics are from AgentGuard
    const agentguardDiag = {
      code: 'AG-RULE-1',
      message: 'AgentGuard finding',
      source: 'AgentGuard',
      severity: 0,
    };
    (vscode.languages as any).getDiagnostics = () => [agentguardDiag];
    (vscode.languages as any)._fireDidChangeDiagnostics({ uris: [fileUri] });

    // Ensure queue remains empty for AgentGuard's own diagnostics
    assert.strictEqual(
      monitor.getPendingCount(),
      0,
      'AgentGuard self-published diagnostics must never queue change events'
    );

    // Now fire diagnostic update from TypeScript compiler (external)
    const genuineDiag = {
      code: 2304,
      message: 'Cannot find name auth',
      source: 'typescript',
      severity: 0,
    };
    (vscode.languages as any).getDiagnostics = () => [genuineDiag];

    monitor.onDidBatchReady(batch => {
      const sources = batch.events.map(e => e.source);
      assert.ok(sources.includes('diagnostics'), 'Should process genuine external diagnostic update');
      monitor.dispose();
      done();
    });

    (vscode.languages as any)._fireDidChangeDiagnostics({ uris: [fileUri] });
  });

  // -------------------------------------------------------------------------
  // 2. Automatic Finding Lifecycle: Reconcile Scope & Auto-Clearing Resolved Findings
  // -------------------------------------------------------------------------
  test('2. Lifecycle: automatically clears resolved findings when bug is fixed, moving them to history', () => {
    const findingManager = new FindingManager(logger);
    const publisher = new NativeDiagnosticsPublisher(findingManager, logger);

    const fileUri = vscode.Uri.file('/workspace/src/math.ts');
    const finding: Finding = {
      id: 'f-math-1',
      ruleId: 'type-safety/unresolved-symbol',
      category: 'confirmed-new-diagnostic',
      severity: 'error',
      confidence: 'high',
      evidenceClassification: 'confirmed-regression',
      status: 'open',
      verificationState: 'unverified',
      title: 'Unresolved symbol calculateTotal',
      message: 'Cannot find name calculateTotal',
      explanation: 'Referenced symbol does not exist in scope',
      evidence: 'calculateTotal(10, 20);',
      location: {
        filePath: '/workspace/src/math.ts',
        uri: fileUri,
        range: new vscode.Range(10, 0, 10, 20),
      },
      sourceEngine: 'diagnostic-delta',
      timestamp: Date.now(),
    };

    findingManager.addFinding(finding);
    assert.strictEqual(findingManager.getAll().length, 1);
    assert.strictEqual(findingManager.getStats().errors, 1);

    // Code is modified and re-analyzed: the bug was fixed!
    // Engine reconciles scope for math.ts with 0 findings in generation 1
    findingManager.reconcileScope('diagnostic-delta', [fileUri], [], 1);

    // Active findings must now be 0 without requiring VS Code reload or manual refresh
    assert.strictEqual(findingManager.getAll().length, 0, 'Active findings must be cleared');
    assert.strictEqual(findingManager.getStats().errors, 0, 'Error count must drop to 0');
    assert.strictEqual(findingManager.getStats().total, 0, 'Total count must drop to 0');

    // Resolved finding must be tracked in resolution history
    const history = findingManager.getResolvedHistory();
    assert.strictEqual(history.length, 1, 'Resolved finding preserved in history');
    assert.strictEqual(history[0]?.status, 'resolved', 'Status must be resolved');
    assert.strictEqual(
      history[0]?.verificationState,
      'verified-clean',
      'Verification state must be verified-clean'
    );

    findingManager.dispose();
    publisher.dispose();
  });

  // -------------------------------------------------------------------------
  // 3. Race Conditions: Monotonic Generation IDs & Stale-Result Rejection
  // -------------------------------------------------------------------------
  test('3. Race Conditions: stale results from older generations are rejected and never overwrite newer findings', () => {
    const findingManager = new FindingManager(logger);
    const fileUri = vscode.Uri.file('/workspace/src/service.ts');

    const freshFinding: Finding = {
      id: 'f-gen-2',
      ruleId: 'logic-safety/auth-guard',
      category: 'logic-risk',
      severity: 'error',
      confidence: 'high',
      evidenceClassification: 'confirmed-regression',
      status: 'open',
      title: 'Auth guard removed in Gen 2',
      message: 'Auth check removed',
      explanation: 'Security risk',
      evidence: '- app.use(auth);',
      location: { filePath: '/workspace/src/service.ts', uri: fileUri },
      sourceEngine: 'logic-watchdog',
      timestamp: Date.now(),
      analysisGeneration: 2,
    };

    // Generation 2 successfully updates findings
    findingManager.reconcileScope('logic-watchdog', [fileUri], [freshFinding], 2);
    assert.strictEqual(findingManager.getAll().length, 1);
    assert.strictEqual(findingManager.getAll()[0]?.title, 'Auth guard removed in Gen 2');

    // Generation 1 finishes late (out of order due to slower network/disk)
    const staleFinding: Finding = {
      id: 'f-gen-1',
      ruleId: 'logic-safety/old',
      category: 'logic-risk',
      severity: 'warning',
      confidence: 'medium',
      status: 'open',
      title: 'Old finding from Gen 1',
      message: 'Old message',
      explanation: 'Out of date analysis',
      evidence: 'old code',
      location: { filePath: '/workspace/src/service.ts', uri: fileUri },
      sourceEngine: 'logic-watchdog',
      timestamp: Date.now() - 5000,
      analysisGeneration: 1,
    };

    findingManager.reconcileScope('logic-watchdog', [fileUri], [staleFinding], 1);

    // Stale Gen 1 must be rejected; Gen 2 finding must remain active
    assert.strictEqual(findingManager.getAll().length, 1, 'Should still only have 1 finding');
    assert.strictEqual(
      findingManager.getAll()[0]?.title,
      'Auth guard removed in Gen 2',
      'Gen 2 finding must not be overwritten by stale Gen 1'
    );

    findingManager.dispose();
  });

  // -------------------------------------------------------------------------
  // 4. Line-Shift Resilience & Identity Stability
  // -------------------------------------------------------------------------
  test('4. Line Shifts: findings moving to different lines update in-place without duplicating', () => {
    const findingManager = new FindingManager(logger);
    const fileUri = vscode.Uri.file('/workspace/src/checkout.ts');

    const initialFinding: Finding = {
      id: 'f-checkout-1',
      ruleId: 'silent-regression-removed-await',
      category: 'logic-risk',
      severity: 'error',
      confidence: 'high',
      evidenceClassification: 'structural-regression',
      status: 'open',
      title: 'Missing await before payment.process()',
      message: 'Floating promise',
      explanation: 'Promise dropped',
      evidence: 'payment.process();',
      location: {
        filePath: '/workspace/src/checkout.ts',
        uri: fileUri,
        range: new vscode.Range(15, 4, 15, 25),
      },
      sourceEngine: 'logic-watchdog',
      timestamp: 1000,
    };

    findingManager.addFinding(initialFinding);
    assert.strictEqual(findingManager.getAll().length, 1);

    // Developer adds 5 lines above; the error is now at line 20
    const shiftedFinding: Finding = {
      ...initialFinding,
      id: 'f-checkout-1-shifted',
      location: {
        filePath: '/workspace/src/checkout.ts',
        uri: fileUri,
        range: new vscode.Range(20, 4, 20, 25),
      },
      timestamp: 2000,
    };

    findingManager.addFinding(shiftedFinding);

    // Must recognize line-shift and update in-place without duplicating
    assert.strictEqual(findingManager.getAll().length, 1, 'Must not duplicate shifted finding');
    assert.strictEqual(
      findingManager.getAll()[0]?.location.range?.start.line,
      20,
      'Range must be updated to line 20'
    );

    findingManager.dispose();
  });

  // -------------------------------------------------------------------------
  // 5. File Rename and Delete Tracking
  // -------------------------------------------------------------------------
  test('5. Workspace Changes: handles file rename and file deletion cleanly', () => {
    const findingManager = new FindingManager(logger);
    const oldUri = vscode.Uri.file('/workspace/src/old-name.ts');
    const newUri = vscode.Uri.file('/workspace/src/new-name.ts');

    const finding: Finding = {
      id: 'f-rename-1',
      ruleId: 'type-safety/syntax',
      category: 'confirmed-new-diagnostic',
      severity: 'error',
      confidence: 'high',
      status: 'open',
      title: 'Syntax error in old file',
      message: 'Syntax error',
      explanation: 'Missing semicolon',
      evidence: 'const a =',
      location: { filePath: '/workspace/src/old-name.ts', uri: oldUri },
      sourceEngine: 'diagnostic-delta',
      timestamp: Date.now(),
    };

    findingManager.addFinding(finding);
    assert.strictEqual(findingManager.getFindingsForUri(oldUri).length, 1);

    // File renamed: migrateUri
    findingManager.migrateUri(oldUri, newUri);
    assert.strictEqual(findingManager.getFindingsForUri(oldUri).length, 0);
    const newFindings = findingManager.getFindingsForUri(newUri);
    assert.strictEqual(newFindings.length, 1);
    assert.strictEqual(newFindings[0]?.location.filePath, '/workspace/src/new-name.ts');

    // File deleted: removeFindingsForUri
    findingManager.removeFindingsForUri(newUri);
    assert.strictEqual(findingManager.getAll().length, 0, 'Deleted file findings must be removed');

    findingManager.dispose();
  });

  // -------------------------------------------------------------------------
  // 6. Code-Change Impact Analysis: Root-Cause Grouping
  // -------------------------------------------------------------------------
  test('6. Code-Change Impact: groups multiple untouched consumer breakages under one root cause', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentguard-group-impact-test-'));
    try {
      const rootUri = vscode.Uri.file(tempDir);
      (vscode.workspace as any).workspaceFolders = [
        { uri: rootUri, name: 'Root', index: 0 },
      ];
      const workspaceManager = new WorkspaceManager(logger);
      const languageRegistry = new LanguageAdapterRegistry(logger);
      languageRegistry.registerBuiltinAdapters();
      const gitService = new GitService(logger);
      const diagnosticTracker = new DiagnosticTracker(workspaceManager, languageRegistry, logger);

      const engine = new BlastRadiusEngine(
        workspaceManager,
        languageRegistry,
        diagnosticTracker,
        gitService,
        logger
      );

      const srcDir = path.join(tempDir, 'src');
      fs.mkdirSync(srcDir, { recursive: true });

      const providerFile = path.join(srcDir, 'user-service.ts');
      const providerUri = vscode.Uri.file(providerFile);

      const consumer1File = path.join(srcDir, 'auth.ts');
      const consumer1Uri = vscode.Uri.file(consumer1File);
      fs.writeFileSync(
        consumer1File,
        "import { getUser } from './user-service';\nexport function f1() { getUser(); }\n"
      );

      const consumer2File = path.join(srcDir, 'profile.ts');
      const consumer2Uri = vscode.Uri.file(consumer2File);
      fs.writeFileSync(
        consumer2File,
        "import { getUser } from './user-service';\nexport function f2() { getUser(); }\n"
      );

      const consumer3File = path.join(srcDir, 'admin.ts');
      const consumer3Uri = vscode.Uri.file(consumer3File);
      fs.writeFileSync(
        consumer3File,
        "import { getUser } from './user-service';\nexport function f3() { getUser(); }\n"
      );

      // Previous AST for user-service.ts had getUser
      engine.seedAstCache(providerUri, [
        {
          kind: 'function',
          name: 'getUser',
          startLine: 1,
          endLine: 5,
          details: 'getUser(): void',
        },
      ]);

      // Now user-service.ts has getUser DELETED
      fs.writeFileSync(providerFile, 'export function newMethod() {}\n');

      // Pre-seed dependencies
      await engine.dependencyGraph.analyzeFileDependencies(consumer1Uri);
      await engine.dependencyGraph.analyzeFileDependencies(consumer2Uri);
      await engine.dependencyGraph.analyzeFileDependencies(consumer3Uri);

      const findings = await engine.analyze({
        workspaceRoots: workspaceManager.getRoots(),
        targetUris: [providerUri],
      });

      // 3 untouched files affected -> grouped into 1 root-cause finding!
      assert.strictEqual(findings.length, 1, 'Should produce 1 grouped root-cause finding');
      const rootFinding = findings[0]!;
      assert.strictEqual(rootFinding.severity, 'error');
      assert.strictEqual(rootFinding.confidence, 'high');
      assert.strictEqual(rootFinding.evidenceClassification, 'structural-regression');
      assert.ok(
        rootFinding.title.includes('getUser') && rootFinding.title.includes('3'),
        `Title should mention getUser and 3: ${rootFinding.title}`
      );
      assert.strictEqual(
        rootFinding.relatedLocations?.length,
        3,
        'Must contain 3 consumer locations'
      );
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  // -------------------------------------------------------------------------
  // 7. Silent Behavior Regression Rules
  // -------------------------------------------------------------------------
  test('7a. Silent Regression: detects removed await (floating promise)', async () => {
    const rule = new SilentRegressionRule();
    const uri = vscode.Uri.file('/workspace/src/db.ts');

    const findings = await rule.inspect({
      uri,
      relativeFilePath: 'src/db.ts',
      isTestFile: false,
      oldContent: 'await client.query("UPDATE accounts SET balance = 0");',
      newContent: 'client.query("UPDATE accounts SET balance = 0");',
      removedLines: [
        {
          line: 20,
          text: 'await client.query("UPDATE accounts SET balance = 0");',
          trimmed: 'await client.query("UPDATE accounts SET balance = 0");',
        },
      ],
      addedLines: [
        {
          line: 20,
          text: 'client.query("UPDATE accounts SET balance = 0");',
          trimmed: 'client.query("UPDATE accounts SET balance = 0");',
        },
      ],
      languageId: 'typescript',
    });

    assert.strictEqual(findings.length, 1, 'Should detect removed await');
    assert.ok(findings[0]?.title.includes("await' Keyword Removed"));
    assert.strictEqual(findings[0]?.severity, 'warning');
    assert.strictEqual(findings[0]?.confidence, 'high');
  });

  test('7b. Silent Regression: detects newly empty catch block swallowing errors', async () => {
    const rule = new SilentRegressionRule();
    const uri = vscode.Uri.file('/workspace/src/api.ts');

    const findings = await rule.inspect({
      uri,
      relativeFilePath: 'src/api.ts',
      isTestFile: false,
      oldContent: 'try { doWork(); } catch (err) { logger.error(err); throw err; }',
      newContent: 'try { doWork(); } catch (err) {}',
      removedLines: [
        {
          line: 16,
          text: 'logger.error(err); throw err;',
          trimmed: 'logger.error(err); throw err;',
        },
      ],
      addedLines: [
        {
          line: 15,
          text: 'catch (err) {}',
          trimmed: 'catch (err) {}',
        },
      ],
      languageId: 'typescript',
    });

    assert.ok(findings.length >= 1, 'Should detect silent regression in catch');
    const emptyCatch = findings.find(f => f.title.includes('Empty Catch Block'));
    assert.ok(emptyCatch, 'Should trigger empty catch block finding');
    assert.strictEqual(emptyCatch?.confidence, 'high');
  });

  test('7c. Silent Regression: detects removed transaction rollback', async () => {
    const rule = new SilentRegressionRule();
    const uri = vscode.Uri.file('/workspace/src/transfer.ts');

    const findings = await rule.inspect({
      uri,
      relativeFilePath: 'src/transfer.ts',
      isTestFile: false,
      oldContent: 'try { await tx.commit(); } catch (e) { await tx.rollback(); }',
      newContent: 'try { await tx.commit(); } catch (e) {}',
      removedLines: [
        {
          line: 30,
          text: 'await tx.rollback();',
          trimmed: 'await tx.rollback();',
        },
      ],
      addedLines: [],
      languageId: 'typescript',
    });

    const rollbackFinding = findings.find(f => f.title.includes('Transaction Rollback Removed'));
    assert.ok(rollbackFinding, 'Should detect removed transaction rollback');
    assert.strictEqual(rollbackFinding?.severity, 'critical');
  });

  test('7d. Silent Regression: detects removed optional chaining operator', async () => {
    const rule = new SilentRegressionRule();
    const uri = vscode.Uri.file('/workspace/src/profile.ts');

    const findings = await rule.inspect({
      uri,
      relativeFilePath: 'src/profile.ts',
      isTestFile: false,
      oldContent: 'const zip = user?.address?.zipCode;',
      newContent: 'const zip = user.address.zipCode;',
      removedLines: [
        {
          line: 8,
          text: 'const zip = user?.address?.zipCode;',
          trimmed: 'const zip = user?.address?.zipCode;',
        },
      ],
      addedLines: [
        {
          line: 8,
          text: 'const zip = user.address.zipCode;',
          trimmed: 'const zip = user.address.zipCode;',
        },
      ],
      languageId: 'typescript',
    });

    const optChainFinding = findings.find(f => f.title.includes('Optional Chaining Removed'));
    assert.ok(optChainFinding, 'Should detect removed optional chaining');
  });

  // -------------------------------------------------------------------------
  // 8. AI Fix Prompt Generation & Hover Provider
  // -------------------------------------------------------------------------
  test('8. AI Fix Prompt: formats structured actionable instructions for coding agents', () => {
    const fileUri = vscode.Uri.file('/workspace/src/auth.ts');
    const finding: Finding = {
      id: 'f-prompt-1',
      ruleId: 'silent-regression-removed-await',
      category: 'logic-risk',
      severity: 'error',
      confidence: 'high',
      evidenceClassification: 'structural-regression',
      status: 'open',
      title: 'Removed await before verifyToken()',
      message: 'Unawaited promise',
      explanation:
        'verifyToken() returns a Promise. Removing await causes unauthenticated requests to pass through.',
      evidence: '- await verifyToken(token);\n+ verifyToken(token);',
      suggestedRemediation:
        'Restore `await` or chain `.catch()` to ensure authentication errors are caught.',
      location: {
        filePath: '/workspace/src/auth.ts',
        uri: fileUri,
        range: new vscode.Range(42, 4, 42, 24),
      },
      sourceEngine: 'logic-watchdog',
      timestamp: Date.now(),
    };

    const prompt = CommandHandler.buildAiFixPrompt(finding);
    assert.ok(prompt.includes('# AgentGuard Codebase Safety Fix Request'));
    assert.ok(prompt.includes('Removed await before verifyToken()'));
    assert.ok(prompt.includes('/workspace/src/auth.ts:43'));
    assert.ok(prompt.includes('structural-regression'));
    assert.ok(prompt.includes('Restore `await`'));
    assert.ok(prompt.includes('Do not introduce breaking contract changes'));
  });

  test('9. Hover Provider: renders rich Markdown hover with [Copy AI Fix Prompt] command', () => {
    const findingManager = new FindingManager(logger);
    const fileUri = vscode.Uri.file('/workspace/src/payment.ts');
    const finding: Finding = {
      id: 'f-hover-1',
      ruleId: 'logic-safety/missing-check',
      category: 'logic-risk',
      severity: 'error',
      confidence: 'high',
      evidenceClassification: 'confirmed-regression',
      status: 'open',
      title: 'Payment validation removed',
      message: 'Missing amount check',
      explanation: 'Negative payment amounts are now accepted without validation.',
      evidence: '- if (amount <= 0) throw new Error();',
      suggestedRemediation: 'Reintroduce amount validation.',
      location: {
        filePath: '/workspace/src/payment.ts',
        uri: fileUri,
        range: new vscode.Range(25, 0, 25, 30),
      },
      sourceEngine: 'logic-watchdog',
      timestamp: Date.now(),
    };

    findingManager.addFinding(finding);

    const hoverProvider = new FindingHoverProvider(findingManager);
    const mockDoc = {
      uri: fileUri,
      scheme: 'file',
    } as any;

    const hover = hoverProvider.provideHover(
      mockDoc,
      new vscode.Position(25, 10),
      {} as any
    ) as any;

    assert.ok(hover, 'Hover should be returned for position line 25');
    const markdown = hover.contents.value;
    assert.ok(markdown.includes('AgentGuard: Payment validation removed'));
    assert.ok(markdown.includes('CRITICAL'));
    assert.ok(markdown.includes('Copy AI Fix Prompt'));
    assert.ok(markdown.includes('command:agentguard.copyFindingFixPrompt'));

    findingManager.dispose();
  });
});
