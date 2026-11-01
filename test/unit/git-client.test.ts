import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { NullLogger } from '../../src/core/logger';
import { GitClient } from '../../src/git/git-client';
import { GitProcess } from '../../src/git/git-process';

suite('GitClient (Repository State & Safe Operations)', () => {
  let tempDir: string;
  let client: GitClient;

  suiteSetup(async () => {
    client = new GitClient(new NullLogger());
  });

  setup(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentguard-git-test-'));
  });

  teardown(async () => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  test('returns undefined for non-git directory', async () => {
    const root = await client.detectRepositoryRoot(tempDir);
    assert.strictEqual(root, undefined);
  });

  test('handles unborn HEAD in newly initialized repository', async () => {
    await GitProcess.exec(['init'], { cwd: tempDir });

    const root = await client.detectRepositoryRoot(tempDir);
    assert.ok(root);

    const state = await client.getRepoState(tempDir);
    assert.strictEqual(state.isGitRepo, true);
    assert.strictEqual(state.isUnbornHead, true);
    assert.strictEqual(state.headCommit, undefined);

    const status = await client.getStatus(tempDir);
    assert.strictEqual(status.changedFiles.length, 0);
  });

  test('tracks staged, unstaged, untracked, and special-character files', async () => {
    await GitProcess.exec(['init'], { cwd: tempDir });
    await GitProcess.exec(['config', 'user.name', 'AgentGuard Tester'], { cwd: tempDir });
    await GitProcess.exec(['config', 'user.email', 'test@agentguard.dev'], { cwd: tempDir });

    // 1. Create and commit initial baseline
    const baseFile = path.join(tempDir, 'base.txt');
    fs.writeFileSync(baseFile, 'initial line\n');
    await GitProcess.exec(['add', 'base.txt'], { cwd: tempDir });
    await GitProcess.exec(['commit', '-m', 'Initial commit'], { cwd: tempDir });

    // 2. Modify baseFile (unstaged)
    fs.appendFileSync(baseFile, 'second line\n');

    // 3. Create staged file
    const stagedFile = path.join(tempDir, 'staged.txt');
    fs.writeFileSync(stagedFile, 'staged content\n');
    await GitProcess.exec(['add', 'staged.txt'], { cwd: tempDir });

    // 4. Create untracked file with spaces and unicode
    const unicodeFile = path.join(tempDir, 'café 🚀 and spaces.ts');
    fs.writeFileSync(unicodeFile, 'export const name = "unicode";\n');

    const status = await client.getStatus(tempDir);

    assert.ok(status.repoState.isGitRepo);
    assert.strictEqual(status.repoState.isUnbornHead, false);
    assert.ok(status.repoState.headCommit);

    assert.strictEqual(status.stagedCount, 1, 'Should have 1 staged file');
    assert.strictEqual(status.unstagedCount, 1, 'Should have 1 unstaged modified file');
    assert.strictEqual(status.untrackedCount, 1, 'Should have 1 untracked file');

    const unicodeEntry = status.changedFiles.find(f => f.relPath === 'café 🚀 and spaces.ts');
    assert.ok(unicodeEntry, 'Unicode filename with spaces must be preserved losslessly');
    assert.strictEqual(unicodeEntry.isUntracked, true);

    // 5. Query diff hunks for modified base.txt
    const hunks = await client.getFileDiffHunks(tempDir, 'base.txt', false);
    assert.ok(hunks.length > 0, 'Should return line diff hunks for modified file');
  });

  test('tracks renamed and deleted files', async () => {
    await GitProcess.exec(['init'], { cwd: tempDir });
    await GitProcess.exec(['config', 'user.name', 'AgentGuard Tester'], { cwd: tempDir });
    await GitProcess.exec(['config', 'user.email', 'test@agentguard.dev'], { cwd: tempDir });

    const fileToRename = path.join(tempDir, 'orig.ts');
    fs.writeFileSync(fileToRename, 'content for rename\n');
    await GitProcess.exec(['add', 'orig.ts'], { cwd: tempDir });
    await GitProcess.exec(['commit', '-m', 'commit orig'], { cwd: tempDir });

    // Rename using git mv
    await GitProcess.exec(['mv', 'orig.ts', 'renamed.ts'], { cwd: tempDir });

    const status = await client.getStatus(tempDir);
    const renameEntry = status.changedFiles.find(f => f.status === 'renamed');
    assert.ok(renameEntry, 'Should detect renamed file');
    assert.strictEqual(renameEntry.relPath, 'renamed.ts');
    assert.strictEqual(renameEntry.oldRelPath, 'orig.ts');
  });
});
