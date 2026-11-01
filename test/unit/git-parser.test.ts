import * as assert from 'assert';
import { GitParser } from '../../src/git/git-parser';

suite('GitParser (NUL-Delimited Porcelain & Unified Diff Hunks)', () => {
  const repoRoot = '/repo';

  test('parses untracked, added, modified, and deleted files correctly', () => {
    // XY <path>\0
    const raw =
      '?? src/new-untracked.ts\0' +
      'A  src/staged-added.ts\0' +
      ' M src/unstaged-modified.ts\0' +
      'M  src/staged-modified.ts\0' +
      'MM src/both-modified.ts\0' +
      ' D src/deleted-worktree.ts\0';

    const files = GitParser.parsePorcelainV1Z(raw, repoRoot);

    assert.strictEqual(files.length, 6);

    const untracked = files.find(f => f.relPath === 'src/new-untracked.ts')!;
    assert.ok(untracked);
    assert.strictEqual(untracked.isUntracked, true);
    assert.strictEqual(untracked.isStaged, false);
    assert.strictEqual(untracked.status, 'untracked');

    const added = files.find(f => f.relPath === 'src/staged-added.ts')!;
    assert.ok(added);
    assert.strictEqual(added.isStaged, true);
    assert.strictEqual(added.status, 'added');

    const unstagedMod = files.find(f => f.relPath === 'src/unstaged-modified.ts')!;
    assert.ok(unstagedMod);
    assert.strictEqual(unstagedMod.isStaged, false);
    assert.strictEqual(unstagedMod.status, 'modified');

    const stagedMod = files.find(f => f.relPath === 'src/staged-modified.ts')!;
    assert.ok(stagedMod);
    assert.strictEqual(stagedMod.isStaged, true);
    assert.strictEqual(stagedMod.status, 'modified');

    const deleted = files.find(f => f.relPath === 'src/deleted-worktree.ts')!;
    assert.ok(deleted);
    assert.strictEqual(deleted.status, 'deleted');
  });

  test('parses renamed and copied files with oldRelPath', () => {
    // R <new>\0<old>\0
    const raw =
      'R  src/new-auth.ts\0src/old-auth.ts\0' +
      'C  src/copied-auth.ts\0src/orig-auth.ts\0';

    const files = GitParser.parsePorcelainV1Z(raw, repoRoot);
    assert.strictEqual(files.length, 2);

    const renamed = files[0]!;
    assert.strictEqual(renamed.status, 'renamed');
    assert.strictEqual(renamed.relPath, 'src/new-auth.ts');
    assert.strictEqual(renamed.oldRelPath, 'src/old-auth.ts');

    const copied = files[1]!;
    assert.strictEqual(copied.status, 'copied');
    assert.strictEqual(copied.relPath, 'src/copied-auth.ts');
    assert.strictEqual(copied.oldRelPath, 'src/orig-auth.ts');
  });

  test('parses filenames with spaces, quotes, and Unicode characters losslessly', () => {
    const raw =
      '?? src/my folder with spaces/file 1.ts\0' +
      ' M "src/quoted-name"/test.ts\0' +
      'A  src/café-🚀/тест.ts\0';

    const files = GitParser.parsePorcelainV1Z(raw, repoRoot);
    assert.strictEqual(files.length, 3);

    assert.strictEqual(files[0]?.relPath, 'src/my folder with spaces/file 1.ts');
    assert.strictEqual(files[1]?.relPath, '"src/quoted-name"/test.ts');
    assert.strictEqual(files[2]?.relPath, 'src/café-🚀/тест.ts');
  });

  test('parses unified diff hunks and extracts line ranges', () => {
    const diff = `
diff --git a/src/index.ts b/src/index.ts
--- a/src/index.ts
+++ b/src/index.ts
@@ -10,5 +10,8 @@ export function init() {
@@ -50,0 +53,4 @@ export function check() {
@@ -100 +105,2 @@ export function run() {
`;

    const hunks = GitParser.parseUnifiedDiffHunks(diff);
    assert.strictEqual(hunks.length, 3);

    assert.deepStrictEqual(hunks[0], {
      oldStart: 10,
      oldCount: 5,
      newStart: 10,
      newCount: 8,
    });

    assert.deepStrictEqual(hunks[1], {
      oldStart: 50,
      oldCount: 0,
      newStart: 53,
      newCount: 4,
    });

    assert.deepStrictEqual(hunks[2], {
      oldStart: 100,
      oldCount: 1,
      newStart: 105,
      newCount: 2,
    });
  });

  test('caps diff hunks to prevent memory explosion on large diffs', () => {
    const largeDiff = Array.from({ length: 50 }, (_, i) => `@@ -${i * 10},1 +${i * 10},1 @@`).join('\n');
    const hunks = GitParser.parseUnifiedDiffHunks(largeDiff, 10);
    assert.strictEqual(hunks.length, 10, 'Hunks must be capped at maxHunks');
  });
});

