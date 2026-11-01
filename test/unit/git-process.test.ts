import * as assert from 'assert';
import * as vscode from 'vscode';
import { GitProcess } from '../../src/git/git-process';

suite('GitProcess (Safe Subprocess Execution)', () => {
  test('executes git --version using argument arrays without shell interpolation', async () => {
    const res = await GitProcess.exec(['--version']);
    assert.strictEqual(res.exitCode, 0);
    assert.ok(res.stdout.includes('git version'));
  });

  test('reports availability accurately', async () => {
    GitProcess.resetAvailabilityCache();
    const available = await GitProcess.isAvailable();
    assert.strictEqual(available, true);
  });

  test('returns non-zero exit code on invalid git arguments without throwing', async () => {
    const res = await GitProcess.exec(['--invalid-flag-that-does-not-exist']);
    assert.notStrictEqual(res.exitCode, 0);
    assert.ok(res.stderr.length > 0 || res.stdout.length > 0);
  });

  test('aborts execution when cancellation token is cancelled', async () => {
    const tokenSource = new vscode.CancellationTokenSource();
    const execPromise = GitProcess.exec(['status'], {
      token: tokenSource.token,
    });

    tokenSource.cancel();
    const res = await execPromise;
    assert.strictEqual(res.exitCode, -1);
    assert.strictEqual(res.stderr, 'Operation cancelled');
  });
});
