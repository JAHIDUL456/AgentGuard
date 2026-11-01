import * as assert from 'assert';
import { isIgnoredPath, normalizePath } from '../../src/utils/path-utils';

suite('Path Utilities', () => {
  test('normalizePath converts backslashes to forward slashes', () => {
    assert.strictEqual(normalizePath('foo\\bar\\baz.ts'), 'foo/bar/baz.ts');
  });

  test('isIgnoredPath identifies build, git, and node_modules folders', () => {
    assert.strictEqual(isIgnoredPath('/project/node_modules/pkg/index.js'), true);
    assert.strictEqual(isIgnoredPath('/project/.git/HEAD'), true);
    assert.strictEqual(isIgnoredPath('/project/dist/extension.js'), true);
    assert.strictEqual(isIgnoredPath('/project/out/test.js'), true);
    assert.strictEqual(isIgnoredPath('/project/.vscode-test/stable'), true);

    assert.strictEqual(isIgnoredPath('/project/src/index.ts'), false);
    assert.strictEqual(isIgnoredPath('/project/package.json'), false);
  });
});

