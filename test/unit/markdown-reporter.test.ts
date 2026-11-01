import * as assert from 'assert';
import * as vscode from 'vscode';
import { Finding } from '../../src/core/types';
import { FindingStats } from '../../src/findings/types';
import { MarkdownReporter } from '../../src/reporting/markdown-reporter';

suite('MarkdownReporter', () => {
  const reporter = new MarkdownReporter();

  test('generates healthy report when zero findings exist', () => {
    const stats: FindingStats = {
      total: 0,
      errors: 0,
      warnings: 0,
      infos: 0,
      byCategory: {
        'untouched-file': 0,
        'diagnostic-regression': 0,
        'logic-risk': 0,
        'broken-dependency': 0,
      },
    };

    const md = reporter.generateReport([], stats, {
      workspaceName: 'AgentGuardCore',
      generatedAt: new Date('2026-01-01T00:00:00Z'),
    });

    assert.ok(md.includes('# AgentGuard Codebase Safety Report'));
    assert.ok(md.includes('Zero safety issues detected'));
    assert.ok(md.includes('AgentGuardCore'));
  });

  test('formats detailed finding entries when findings exist', () => {
    const finding: Finding = {
      id: 'f-1',
      category: 'broken-dependency',
      severity: 'error',
      title: 'Missing package import',
      message: 'Package was uninstalled but still imported.',
      location: {
        filePath: 'src/index.ts',
        uri: vscode.Uri.file('/app/src/index.ts'),
      },
      sourceEngine: 'dep-engine',
      timestamp: Date.now(),
    };

    const stats: FindingStats = {
      total: 1,
      errors: 1,
      warnings: 0,
      infos: 0,
      byCategory: {
        'untouched-file': 0,
        'diagnostic-regression': 0,
        'logic-risk': 0,
        'broken-dependency': 1,
      },
    };

    const md = reporter.generateReport([finding], stats);
    assert.ok(md.includes('[ERROR] Missing package import'));
    assert.ok(md.includes('Package was uninstalled but still imported'));
    assert.ok(md.includes('src/index.ts'));
  });
});

