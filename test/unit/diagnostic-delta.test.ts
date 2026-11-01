import * as assert from 'assert';
import * as vscode from 'vscode';
import { DiagnosticDeltaEngine } from '../../src/analysis/diagnostics/diagnostic-delta-engine';
import {
  correlateDiagnostics,
  createDiagnosticFingerprint,
  normalizeDiagnosticMessage,
} from '../../src/analysis/diagnostics/diagnostic-fingerprint';
import { DiagnosticSettler } from '../../src/analysis/diagnostics/diagnostic-settler';
import { DiagnosticTracker } from '../../src/analysis/diagnostics/diagnostic-tracker';
import { DiagnosticFingerprint } from '../../src/analysis/diagnostics/diagnostic-types';
import { NullLogger } from '../../src/core/logger';
import { LanguageAdapterRegistry } from '../../src/languages/adapter-registry';
import { WorkspaceManager } from '../../src/workspace/workspace-manager';

suite('Diagnostic Delta & Settling Engine', () => {
  const logger = new NullLogger();

  test('normalizes messages to resist shifting lines, column numbers, and memory addresses', () => {
    const rawMsg1 = "Cannot find name 'foo' (line 42, col 5) at 0x7fff5fbff8c0";
    const rawMsg2 = "Cannot find name 'foo' (line 99, col 12) at 0x1234abcd";
    const normalized1 = normalizeDiagnosticMessage(rawMsg1);
    const normalized2 = normalizeDiagnosticMessage(rawMsg2);

    assert.strictEqual(normalized1, normalized2);
    assert.strictEqual(normalized1, "Cannot find name 'foo' at 0x...");
  });

  test('suppresses pre-existing baseline errors and does not report them as regressions', () => {
    const uri = vscode.Uri.file('/workspace/src/app.ts');
    const rootUri = vscode.Uri.file('/workspace');

    // Baseline diagnostic at line 10
    const baselineDiag = new vscode.Diagnostic(
      new vscode.Range(10, 0, 10, 20),
      "Type 'string' is not assignable to type 'number'.",
      vscode.DiagnosticSeverity.Error
    );
    baselineDiag.source = 'ts';
    baselineDiag.code = 'TS2322';

    const baselineFp = createDiagnosticFingerprint(uri, baselineDiag, rootUri);

    // Current diagnostic at line 10
    const currentDiag = new vscode.Diagnostic(
      new vscode.Range(10, 0, 10, 20),
      "Type 'string' is not assignable to type 'number'.",
      vscode.DiagnosticSeverity.Error
    );
    currentDiag.source = 'ts';
    currentDiag.code = 'TS2322';

    const currentFp = createDiagnosticFingerprint(uri, currentDiag, rootUri);

    const correlated = correlateDiagnostics([baselineFp], [currentFp], true);

    assert.strictEqual(correlated.length, 1);
    assert.strictEqual(correlated[0]!.classification, 'existing');
  });

  test('correctly identifies existing diagnostics when lines shift due to edits above', () => {
    const uri = vscode.Uri.file('/workspace/src/app.ts');
    const rootUri = vscode.Uri.file('/workspace');

    // Baseline error at line 15
    const baselineDiag = new vscode.Diagnostic(
      new vscode.Range(15, 4, 15, 25),
      "Property 'secretKey' does not exist on type 'Config'.",
      vscode.DiagnosticSeverity.Error
    );
    baselineDiag.source = 'ts';
    baselineDiag.code = 'TS2339';
    const baselineFp = createDiagnosticFingerprint(uri, baselineDiag, rootUri);

    // After adding 10 lines of imports, the exact same error shifted to line 25
    const shiftedDiag = new vscode.Diagnostic(
      new vscode.Range(25, 4, 25, 25),
      "Property 'secretKey' does not exist on type 'Config'.",
      vscode.DiagnosticSeverity.Error
    );
    shiftedDiag.source = 'ts';
    shiftedDiag.code = 'TS2339';
    const shiftedFp = createDiagnosticFingerprint(uri, shiftedDiag, rootUri);

    const correlated = correlateDiagnostics([baselineFp], [shiftedFp], true);

    assert.strictEqual(correlated.length, 1);
    // Crucial: Must be recognized as existing, NOT a new regression!
    assert.strictEqual(correlated[0]!.classification, 'existing');
  });

  test('flags newly introduced errors as confirmed new diagnostics with evidence', () => {
    const uri = vscode.Uri.file('/workspace/src/app.ts');
    const rootUri = vscode.Uri.file('/workspace');

    const baselineFp: DiagnosticFingerprint[] = [];

    // User introduced a new syntax/type error
    const newDiag = new vscode.Diagnostic(
      new vscode.Range(30, 2, 30, 15),
      "Cannot find module './database' or its corresponding type declarations.",
      vscode.DiagnosticSeverity.Error
    );
    newDiag.source = 'ts';
    newDiag.code = 'TS2307';
    const newFp = createDiagnosticFingerprint(uri, newDiag, rootUri);

    const correlated = correlateDiagnostics(baselineFp, [newFp], true);

    assert.strictEqual(correlated.length, 1);
    assert.strictEqual(correlated[0]!.classification, 'confirmed-new-diagnostic');
    assert.strictEqual(correlated[0]!.fingerprint.code, 'TS2307');
  });

  test('recognizes resolved diagnostics when an existing error is fixed', () => {
    const uri = vscode.Uri.file('/workspace/src/app.ts');
    const rootUri = vscode.Uri.file('/workspace');

    const baselineDiag = new vscode.Diagnostic(
      new vscode.Range(5, 0, 5, 10),
      "Unused local variable 'temp'.",
      vscode.DiagnosticSeverity.Warning
    );
    baselineDiag.source = 'ts';
    baselineDiag.code = 'TS6133';
    const baselineFp = createDiagnosticFingerprint(uri, baselineDiag, rootUri);

    // Current state has 0 diagnostics (the warning was fixed)
    const correlated = correlateDiagnostics([baselineFp], [], true);

    assert.strictEqual(correlated.length, 1);
    assert.strictEqual(correlated[0]!.classification, 'resolved');
    assert.strictEqual(correlated[0]!.fingerprint.code, 'TS6133');
  });

  test('handles multiple duplicate diagnostics with count-aware matching', () => {
    const uri = vscode.Uri.file('/workspace/src/app.ts');
    const rootUri = vscode.Uri.file('/workspace');

    // Baseline had 1 instance of TS2304
    const b1 = new vscode.Diagnostic(
      new vscode.Range(10, 0, 10, 5),
      "Cannot find name 'x'.",
      vscode.DiagnosticSeverity.Error
    );
    b1.source = 'ts';
    b1.code = 'TS2304';
    const bFp1 = createDiagnosticFingerprint(uri, b1, rootUri);

    // Current has 2 instances of TS2304 (one at line 12 shifted, and a new one at line 50)
    const c1 = new vscode.Diagnostic(
      new vscode.Range(12, 0, 12, 5),
      "Cannot find name 'x'.",
      vscode.DiagnosticSeverity.Error
    );
    c1.source = 'ts';
    c1.code = 'TS2304';
    const cFp1 = createDiagnosticFingerprint(uri, c1, rootUri);

    const c2 = new vscode.Diagnostic(
      new vscode.Range(50, 0, 50, 5),
      "Cannot find name 'x'.",
      vscode.DiagnosticSeverity.Error
    );
    c2.source = 'ts';
    c2.code = 'TS2304';
    const cFp2 = createDiagnosticFingerprint(uri, c2, rootUri);

    const correlated = correlateDiagnostics([bFp1], [cFp1, cFp2], true);

    const existing = correlated.filter(c => c.classification === 'existing');
    const newDiags = correlated.filter(c => c.classification === 'confirmed-new-diagnostic');

    assert.strictEqual(existing.length, 1, 'Exactly 1 should be matched as existing');
    assert.strictEqual(newDiags.length, 1, 'Exactly 1 should be classified as new');
    assert.strictEqual(newDiags[0]!.fingerprint.line, 50);
  });

  test('classifies as uncertain when baseline is not ready', () => {
    const uri = vscode.Uri.file('/workspace/src/app.ts');
    const rootUri = vscode.Uri.file('/workspace');

    const diag = new vscode.Diagnostic(
      new vscode.Range(1, 0, 1, 10),
      'Some error',
      vscode.DiagnosticSeverity.Error
    );
    const fp = createDiagnosticFingerprint(uri, diag, rootUri);

    // isBaselineReady = false
    const correlated = correlateDiagnostics([], [fp], false);

    assert.strictEqual(correlated.length, 1);
    assert.strictEqual(correlated[0]!.classification, 'uncertain');
  });

  test('DiagnosticSettler settles dynamically within quiet window', async () => {
    const settler = new DiagnosticSettler(logger, {
      quietWindowMs: 50,
      maxWaitMs: 300,
    });

    const settledPromise = settler.waitForSettling();
    const result = await settledPromise;

    assert.strictEqual(result, true, 'Should settle after quiet window');
    settler.dispose();
  });

  test('DiagnosticSettler aborts gracefully when cancellation token fires', async () => {
    const settler = new DiagnosticSettler(logger, {
      quietWindowMs: 100,
      maxWaitMs: 500,
    });

    const tokenSource = new vscode.CancellationTokenSource();
    setTimeout(() => tokenSource.cancel(), 20);

    const result = await settler.waitForSettling(undefined, tokenSource.token);

    assert.strictEqual(result, false, 'Should resolve false on cancellation');
    settler.dispose();
  });

  test('DiagnosticDeltaEngine produces evidence-backed findings for new errors', async () => {
    const rootUri = vscode.Uri.file('/workspace');
    (vscode.workspace as any).workspaceFolders = [
      { uri: rootUri, name: 'Workspace', index: 0 },
    ];
    const workspaceManager = new WorkspaceManager(logger);
    const languageRegistry = new LanguageAdapterRegistry(logger);
    languageRegistry.registerBuiltinAdapters();

    const tracker = new DiagnosticTracker(workspaceManager, languageRegistry, logger);
    const engine = new DiagnosticDeltaEngine(tracker, logger);

    // Mark baseline as ready with 0 baseline errors
    await tracker.captureBaseline();

    // Now inject a diagnostic into VS Code diagnostics for a file
    const fileUri = vscode.Uri.file('/workspace/src/test.ts');
    const mockDiag = new vscode.Diagnostic(
      new vscode.Range(10, 2, 10, 20),
      "Cannot find module './api'",
      vscode.DiagnosticSeverity.Error
    );
    mockDiag.source = 'ts';
    mockDiag.code = 'TS2307';

    // Mock VS Code getDiagnostics
    const originalGetDiagnostics = vscode.languages.getDiagnostics;
    (vscode.languages as any).getDiagnostics = (uri?: vscode.Uri) => {
      if (!uri) {
        return [[fileUri, [mockDiag]]];
      }
      if (uri.fsPath === fileUri.fsPath) {
        return [mockDiag];
      }
      return [];
    };

    try {
      const findings = await engine.analyze({
        workspaceRoots: workspaceManager.getRoots(),
        targetUris: [fileUri],
      });

      assert.strictEqual(findings.length, 1);
      const f = findings[0]!;
      assert.strictEqual(f.category, 'confirmed-new-diagnostic');
      assert.strictEqual(f.severity, 'error');
      assert.strictEqual(f.confidence, 'high');
      assert.ok(f.title.includes('TS2307'));
      assert.ok(f.evidence.includes('Source: ts'));
      assert.ok(f.evidence.includes('Code: TS2307'));
      assert.ok(f.evidence.includes('L11:C3'));
      assert.ok(f.explanation.includes('clean baseline'));
    } finally {
      (vscode.languages as any).getDiagnostics = originalGetDiagnostics;
      tracker.dispose();
      workspaceManager.dispose();
    }
  });
});
