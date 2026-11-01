import * as assert from 'assert';
import { FileFilter, IGNORED_DIRECTORY_NAMES } from '../../src/monitoring/file-filter';

suite('FileFilter & Self-Trigger Prevention', () => {
  test('ignores all specified standard directories', () => {
    const testDirs = [
      '.git',
      'node_modules',
      'vendor',
      'dist',
      'build',
      'out',
      'coverage',
      '.next',
      '.nuxt',
      '.turbo',
      '.cache',
      'target',
      'bin',
      'obj',
      '.vscode-test',
    ];

    for (const dir of testDirs) {
      assert.ok(
        IGNORED_DIRECTORY_NAMES.has(dir),
        `Directory '${dir}' must be in IGNORED_DIRECTORY_NAMES`
      );
      assert.strictEqual(
        FileFilter.shouldIgnore(`/workspace/${dir}/some-file.js`),
        true,
        `Path inside '${dir}' should be ignored`
      );
    }
  });

  test('does not ignore .vscode configuration files', () => {
    assert.strictEqual(
      FileFilter.shouldIgnore('/workspace/.vscode/settings.json'),
      false,
      '.vscode/settings.json should not be ignored'
    );
    assert.strictEqual(
      FileFilter.shouldIgnore('/workspace/.vscode/launch.json'),
      false,
      '.vscode/launch.json should not be ignored'
    );
  });

  test('prevents self-trigger loop on AgentGuard report files', () => {
    const reportFiles = [
      '/workspace/agentguard-report.md',
      '/workspace/agentguard_report.md',
      '/workspace/agentguard-report-2026-01-01.md',
      '/workspace/agentguard-safety-report.md',
      '/workspace/agentguard_safety_report_full.md',
      '/workspace/.agentguard/cache.json',
      '/workspace/.agentguard-state.json',
    ];

    for (const file of reportFiles) {
      assert.strictEqual(
        FileFilter.shouldIgnore(file),
        true,
        `Report file '${file}' should be ignored`
      );
      assert.strictEqual(
        FileFilter.isAgentGuardReport(file),
        true,
        `File '${file}' should be identified as an AgentGuard report`
      );
    }
  });

  test('allows normal source and test files', () => {
    assert.strictEqual(FileFilter.shouldIgnore('/workspace/src/index.ts'), false);
    assert.strictEqual(FileFilter.shouldIgnore('/workspace/test/unit/foo.test.ts'), false);
    assert.strictEqual(FileFilter.shouldIgnore('/workspace/package.json'), false);
    assert.strictEqual(FileFilter.shouldIgnore('/workspace/README.md'), false);
  });
});
