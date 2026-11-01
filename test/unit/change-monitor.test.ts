import * as assert from 'assert';
import * as vscode from 'vscode';
import { NullLogger } from '../../src/core/logger';
import { ChangeMonitor } from '../../src/monitoring/change-monitor';

suite('ChangeMonitor (Comprehensive File Event Monitoring)', () => {
  let monitor: ChangeMonitor;

  setup(() => {
    monitor = new ChangeMonitor(new NullLogger(), {
      debounceMs: 25,
      maxWaitMs: 60,
    });
  });

  teardown(() => {
    monitor.dispose();
  });

  test('captures onDidSaveTextDocument events', done => {
    monitor.onDidBatchReady(batch => {
      assert.strictEqual(batch.events.length, 1);
      assert.strictEqual(batch.events[0]?.source, 'save');
      assert.strictEqual(batch.events[0]?.kind, 'modified');
      assert.strictEqual(batch.events[0]?.uri.fsPath, '/app/src/user.service.ts');
      done();
    });

    (vscode.workspace as any)._fireDidSaveTextDocument({
      uri: vscode.Uri.file('/app/src/user.service.ts'),
    });
  });

  test('captures in-memory onDidChangeTextDocument events', done => {
    monitor.onDidBatchReady(batch => {
      assert.strictEqual(batch.events.length, 1);
      assert.strictEqual(batch.events[0]?.source, 'document');
      assert.strictEqual(batch.events[0]?.uri.fsPath, '/app/src/typing.ts');
      done();
    });

    (vscode.workspace as any)._fireDidChangeTextDocument({
      document: {
        uri: vscode.Uri.file('/app/src/typing.ts'),
      },
      contentChanges: [{ text: 'const a = 1;' }],
    });
  });

  test('captures onDidRenameFiles events with oldUri preserved', done => {
    monitor.onDidBatchReady(batch => {
      assert.strictEqual(batch.events.length, 1);
      const rename = batch.events[0]!;
      assert.strictEqual(rename.kind, 'renamed');
      assert.strictEqual(rename.source, 'rename');
      assert.strictEqual(rename.uri.fsPath, '/app/src/new-api.ts');
      assert.strictEqual(rename.oldUri?.fsPath, '/app/src/old-api.ts');
      done();
    });

    (vscode.workspace as any)._fireDidRenameFiles({
      files: [
        {
          oldUri: vscode.Uri.file('/app/src/old-api.ts'),
          newUri: vscode.Uri.file('/app/src/new-api.ts'),
        },
      ],
    });
  });

  test('captures onDidCreateFiles and onDidDeleteFiles', done => {
    let batchCount = 0;
    monitor.onDidBatchReady(batch => {
      batchCount++;
      if (batchCount === 1) {
        assert.strictEqual(batch.events.length, 2);
        assert.ok(batch.events.some(e => e.kind === 'created' && e.uri.fsPath === '/app/src/created.ts'));
        assert.ok(batch.events.some(e => e.kind === 'deleted' && e.uri.fsPath === '/app/src/deleted.ts'));
        done();
      }
    });

    (vscode.workspace as any)._fireDidCreateFiles({
      files: [vscode.Uri.file('/app/src/created.ts')],
    });
    (vscode.workspace as any)._fireDidDeleteFiles({
      files: [vscode.Uri.file('/app/src/deleted.ts')],
    });
  });

  test('ignores AgentGuard report files to prevent self-trigger feedback loops', done => {
    let batchFired = false;
    monitor.onDidBatchReady(() => {
      batchFired = true;
    });

    (vscode.workspace as any)._fireDidSaveTextDocument({
      uri: vscode.Uri.file('/app/agentguard-report.md'),
    });
    (vscode.workspace as any)._fireDidSaveTextDocument({
      uri: vscode.Uri.file('/app/agentguard-safety-report.md'),
    });
    (vscode.workspace as any)._fireDidSaveTextDocument({
      uri: vscode.Uri.file('/app/node_modules/pkg/index.js'),
    });

    setTimeout(() => {
      assert.strictEqual(batchFired, false, 'Report files and node_modules must not trigger batch events');
      assert.strictEqual(monitor.getPendingCount(), 0);
      done();
    }, 45);
  });
});

