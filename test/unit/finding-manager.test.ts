import * as assert from 'assert';
import * as vscode from 'vscode';
import { NullLogger } from '../../src/core/logger';
import { Finding } from '../../src/core/types';
import { FindingManager } from '../../src/findings/finding-manager';

suite('FindingManager', () => {
  let manager: FindingManager;

  setup(() => {
    manager = new FindingManager(new NullLogger());
  });

  teardown(() => {
    manager.dispose();
  });

  function makeFinding(
    id: string,
    category: Finding['category'],
    severity: Finding['severity'],
    filePath: string
  ): Finding {
    return {
      id,
      category,
      severity,
      title: `Finding ${id}`,
      message: `Message for ${id}`,
      location: {
        filePath,
        uri: vscode.Uri.file(filePath),
      },
      sourceEngine: 'test-engine',
      timestamp: Date.now(),
    };
  }

  test('stores findings and calculates accurate statistics', () => {
    const findings: Finding[] = [
      makeFinding('1', 'untouched-file', 'warning', '/app/src/service.ts'),
      makeFinding('2', 'logic-risk', 'error', '/app/src/auth.ts'),
      makeFinding('3', 'broken-dependency', 'error', '/app/src/api.ts'),
      makeFinding('4', 'diagnostic-regression', 'info', '/app/src/util.ts'),
    ];

    manager.setFindings('test-engine', findings);

    assert.strictEqual(manager.getAll().length, 4);

    const stats = manager.getStats();
    assert.strictEqual(stats.total, 4);
    assert.strictEqual(stats.errors, 2);
    assert.strictEqual(stats.warnings, 1);
    assert.strictEqual(stats.infos, 1);
    assert.strictEqual(stats.byCategory['untouched-file'], 1);
    assert.strictEqual(stats.byCategory['logic-risk'], 1);
    assert.strictEqual(stats.byCategory['broken-dependency'], 1);
    assert.strictEqual(stats.byCategory['diagnostic-regression'], 1);
  });

  test('filters findings by category and severity', () => {
    const findings: Finding[] = [
      makeFinding('1', 'untouched-file', 'warning', '/app/src/service.ts'),
      makeFinding('2', 'logic-risk', 'error', '/app/src/auth.ts'),
    ];
    manager.setFindings('test-engine', findings);

    const errorsOnly = manager.filter({ severities: ['error'] });
    assert.strictEqual(errorsOnly.length, 1);
    assert.strictEqual(errorsOnly[0]?.id, '2');

    const untouchedOnly = manager.filter({ categories: ['untouched-file'] });
    assert.strictEqual(untouchedOnly.length, 1);
    assert.strictEqual(untouchedOnly[0]?.id, '1');
  });

  test('clears findings correctly', () => {
    manager.setFindings('test-engine', [
      makeFinding('1', 'logic-risk', 'error', '/app/src/auth.ts'),
    ]);
    assert.strictEqual(manager.getAll().length, 1);

    manager.clear();
    assert.strictEqual(manager.getAll().length, 0);
    assert.strictEqual(manager.getStats().total, 0);
  });
});

